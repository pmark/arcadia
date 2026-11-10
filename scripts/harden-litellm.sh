#!/usr/bin/env bash
# Harden the local LiteLLM proxy (spend-safety report, PR #2378). OPERATOR-RUN.
#
#   scripts/harden-litellm.sh --budget-usd <USD> [--budget-duration 30d]            dry run (default): prints, changes nothing
#   scripts/harden-litellm.sh --budget-usd <USD> [--budget-duration 30d] --apply    makes the changes
#   scripts/harden-litellm.sh --help
#
# Changes (each printed first, applied only with --apply):
#   1. compose file: publish host port 4000 on 127.0.0.1 only, not every interface.
#   2. config file: global budget under litellm_settings (max_budget + budget_duration).
#   3. config file: the literal provider key becomes api_key: os.environ/<VAR>; the key goes into the
#      macOS keychain (written through `security -i` on stdin, never on a command line), and a small
#      launcher reads it from the keychain into the container environment (compose passes <VAR> through).
#   4. launchd plist: start the launcher instead of `docker compose up`.
# Then it restarts the service and verifies: listener only on 127.0.0.1:4000, liveness OK, the container
# has the variable, and no key-shaped literal remains in the files it manages.
#
# Never prints, logs or passes on a command line the key value. Backs up each changed file with a Pacific
# timestamp (mode 600; a backup of the old config still contains the old key, see the final notes).
# Idempotent: a second run reports "no changes" and restarts nothing.
set -Eeuo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
EDIT=("python3" "-I" "${HERE}/lib/harden_litellm_edit.py")

APPLY=false
BUDGET=""
DURATION="30d"
DIR="${LITELLM_DIR:-${HOME}/Dev/MR/Arcadia/litellm-database}"
CONFIG=""
COMPOSE=""
PLIST="${HOME}/Library/LaunchAgents/com.litellm.proxy.plist"
LABEL="com.litellm.proxy"
CONTAINER="litellm-proxy"
ENV_VAR="OPENAI_API_KEY"
KC_SERVICE="arcadia-litellm-openai"
KC_ACCOUNT="litellm-proxy"
NO_RESTART=false
IGNORE_WINDOW=false
DIAGNOSE=false

usage() {
  cat <<'EOF'
Usage: harden-litellm.sh --budget-usd <USD> [options] [--apply]

Dry run unless --apply is given. --budget-usd is required (no default); it is your decision.

  --budget-usd N          proxy-wide spend cap in USD, a positive number (required)
  --budget-duration D     budget window, e.g. 30d, 7d, 24h (default 30d)
  --apply                 make the changes, restart, verify
  --litellm-dir DIR       default ~/Dev/MR/Arcadia/litellm-database (or $LITELLM_DIR)
  --config FILE           default DIR/litellm_config.docker.yaml
  --compose FILE          default DIR/docker-compose.yml, else docker-compose.yaml
  --plist FILE            default ~/Library/LaunchAgents/com.litellm.proxy.plist
  --container NAME        default litellm-proxy
  --env-var NAME          default OPENAI_API_KEY
  --keychain-service S    default arcadia-litellm-openai (account litellm-proxy)
  --no-restart            apply the files but skip restart and verification
  --diagnose              read-only: show where key-like settings live in the config, compose and .env files,
                          with every value hidden, then exit (no budget needed)
  --ignore-production-window
                          restart even if managed production is Active or unobservable
  -h, --help              this text

Exit codes: 0 ok, 2 usage, 3 refused before any change, 4 applied but verification failed.
EOF
}

die() { printf 'error: %s\n' "$1" >&2; exit "${2:-2}"; }
say() { printf '%s\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=true ;;
    --budget-usd) [ $# -ge 2 ] || die "--budget-usd needs a value"; BUDGET="$2"; shift ;;
    --budget-duration) [ $# -ge 2 ] || die "--budget-duration needs a value"; DURATION="$2"; shift ;;
    --litellm-dir) [ $# -ge 2 ] || die "--litellm-dir needs a value"; DIR="$2"; shift ;;
    --config) [ $# -ge 2 ] || die "--config needs a value"; CONFIG="$2"; shift ;;
    --compose) [ $# -ge 2 ] || die "--compose needs a value"; COMPOSE="$2"; shift ;;
    --plist) [ $# -ge 2 ] || die "--plist needs a value"; PLIST="$2"; shift ;;
    --container) [ $# -ge 2 ] || die "--container needs a value"; CONTAINER="$2"; shift ;;
    --env-var) [ $# -ge 2 ] || die "--env-var needs a value"; ENV_VAR="$2"; shift ;;
    --keychain-service) [ $# -ge 2 ] || die "--keychain-service needs a value"; KC_SERVICE="$2"; shift ;;
    --no-restart) NO_RESTART=true ;;
    --ignore-production-window) IGNORE_WINDOW=true ;;
    --diagnose) DIAGNOSE=true ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
  shift
done

# .env files beside the compose file and in the LiteLLM directory; the same file reached by two paths counts once
ENVFILES=()
collect_envfiles() {
  local f g dup
  ENVFILES=()
  for f in "$(dirname "${COMPOSE}")/.env" "$(dirname "${COMPOSE}")/.env.local" "${DIR}/.env" "${DIR}/.env.local"; do
    [ -f "${f}" ] || continue
    dup=false
    for g in ${ENVFILES[@]+"${ENVFILES[@]}"}; do
      if [ "${f}" -ef "${g}" ]; then dup=true; fi
    done
    if ! ${dup}; then ENVFILES+=("${f}"); fi
  done
}

if ${DIAGNOSE}; then
  CONFIG="${CONFIG:-${DIR}/litellm_config.docker.yaml}"
  if [ -z "${COMPOSE}" ]; then
    COMPOSE="${DIR}/docker-compose.yml"
    [ -f "${COMPOSE}" ] || COMPOSE="${DIR}/docker-compose.yaml"
  fi
  command -v python3 >/dev/null || die "python3 is required" 3
  collect_envfiles
  python3 -I "${HERE}/lib/harden_litellm_edit.py" diagnose "${CONFIG}" "${COMPOSE}" ${ENVFILES[@]+"${ENVFILES[@]}"}
  exit 0
fi
[ -n "${BUDGET}" ] || die "--budget-usd is required: there is no default budget. Choose an amount and pass it."
[[ "${BUDGET}" =~ ^[0-9]+(\.[0-9]+)?$ ]] || die "--budget-usd must be a positive number, got: ${BUDGET}"
awk -v b="${BUDGET}" 'BEGIN { exit !(b > 0) }' || die "--budget-usd must be greater than zero"
[[ "${DURATION}" =~ ^[0-9]+(s|m|h|d|mo)$ ]] || die "--budget-duration must look like 30d, 24h or 1mo, got: ${DURATION}"
[[ "${ENV_VAR}" =~ ^[A-Z_][A-Z0-9_]*$ ]] || die "--env-var must be an upper-case variable name"
[[ "${KC_SERVICE}${KC_ACCOUNT}${CONTAINER}" =~ ^[A-Za-z0-9._-]+$ ]] || die "keychain and container names may only contain letters, digits, . _ -"
CONFIG="${CONFIG:-${DIR}/litellm_config.docker.yaml}"
if [ -z "${COMPOSE}" ]; then
  COMPOSE="${DIR}/docker-compose.yml"
  [ -f "${COMPOSE}" ] || COMPOSE="${DIR}/docker-compose.yaml"
fi
LAUNCHER="$(dirname "${COMPOSE}")/start-litellm.sh"

for f in "${CONFIG}" "${COMPOSE}" "${PLIST}"; do
  [ -f "${f}" ] || die "missing file: ${f} (pass --litellm-dir/--config/--compose/--plist)" 3
done
command -v python3 >/dev/null || die "python3 is required" 3
COMPOSE="$(cd "$(dirname "${COMPOSE}")" && pwd -P)/$(basename "${COMPOSE}")"
LAUNCHER="$(dirname "${COMPOSE}")/start-litellm.sh"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/harden-litellm.XXXXXX")"
trap 'rm -rf "${STAGE}"' EXIT
STAMP="$(TZ=America/Los_Angeles date +%Y%m%d-%H%M%S)"
KC_ARGS=(-s "${KC_SERVICE}" -a "${KC_ACCOUNT}")
MODE="DRY RUN (nothing is changed; add --apply to apply)"
${APPLY} && MODE="APPLY"
say "harden-litellm: ${MODE}  [${STAMP} Pacific]"
say "  config:  ${CONFIG}"
say "  compose: ${COMPOSE}"
say "  plist:   ${PLIST}"
say "  budget:  \$${BUDGET} per ${DURATION}"

# ---- current state (read-only) -----------------------------------------------------------------
listeners() { lsof -nP -iTCP:4000 -sTCP:LISTEN -Fn 2>/dev/null | sed -n 's/^n//p' | sort -u || true; }
CURRENT_LISTENERS="$(listeners)"
say "  current listeners on :4000: ${CURRENT_LISTENERS:-none}"

kc_has() { security find-generic-password "${KC_ARGS[@]}" >/dev/null 2>&1; }
collect_envfiles
find_key() { "${EDIT[@]}" key-find --env-var "${ENV_VAR}" "$@" "${CONFIG}" "${COMPOSE}" ${ENVFILES[@]+"${ENVFILES[@]}"}; }
HAS_LITERAL=false
KEYSRC=""
if KEYSRC="$(find_key)"; then HAS_LITERAL=true; else rc=$?; [ "${rc}" -eq 1 ] || exit "${rc}"; fi

# ---- plan: stage every edited file, nothing touches the real ones -------------------------------
CHANGES=()
CHANGED_FILES=()
note() { CHANGES+=("$1"); }

"${EDIT[@]}" config-edit "${CONFIG}" "${STAGE}/config" --env-var "${ENV_VAR}" --budget "${BUDGET}" --duration "${DURATION}" >"${STAGE}/config.out" || exit $?
COMPOSE_OUT="$("${EDIT[@]}" compose-edit "${COMPOSE}" "${STAGE}/compose" --container "${CONTAINER}" --env-var "${ENV_VAR}")" || exit $?
printf '%s\n' "${COMPOSE_OUT}" >"${STAGE}/compose.out"

DOCKER_BIN=""
if [ -f "${LAUNCHER}" ]; then DOCKER_BIN="$(sed -n 's/^exec "\([^"]*\)" compose.*$/\1/p' "${LAUNCHER}")"; fi
if [ -z "${DOCKER_BIN}" ]; then
  DOCKER_BIN="$("${EDIT[@]}" plist-edit "${PLIST}" "${STAGE}/plist.probe" --launcher "${LAUNCHER}" | sed -n 's/^docker: //p')"
fi
[ -n "${DOCKER_BIN}" ] || DOCKER_BIN="$(command -v docker || true)"
[ -n "${DOCKER_BIN}" ] || die "cannot find the docker binary (plist and PATH both lack it)" 3
"${EDIT[@]}" plist-edit "${PLIST}" "${STAGE}/plist" --launcher "${LAUNCHER}" >"${STAGE}/plist.out" || exit $?

cat >"${STAGE}/launcher" <<EOF
#!/bin/bash
# Generated by scripts/harden-litellm.sh. Holds no secret: it reads the key from the login keychain.
set -euo pipefail
${ENV_VAR}="\$(/usr/bin/security find-generic-password -s ${KC_SERVICE} -a ${KC_ACCOUNT} -w)"
export ${ENV_VAR}
cd "\$(dirname "\$0")"
exec "${DOCKER_BIN}" compose -f "${COMPOSE}" up
EOF

consider() { # name real staged
  if [ ! -f "$2" ] || ! cmp -s "$2" "$3"; then CHANGED_FILES+=("$1|$2|$3"); fi
}
consider config "${CONFIG}" "${STAGE}/config"
consider compose "${COMPOSE}" "${STAGE}/compose"
consider launcher "${LAUNCHER}" "${STAGE}/launcher"
grep -q '^change:' "${STAGE}/plist.out" && consider plist "${PLIST}" "${STAGE}/plist"
ENV_N=0
for f in ${ENVFILES[@]+"${ENVFILES[@]}"}; do
  ENV_N=$((ENV_N + 1))
  "${EDIT[@]}" env-edit "${f}" "${STAGE}/env${ENV_N}" --env-var "${ENV_VAR}" >"${STAGE}/env${ENV_N}.out" || exit $?
  cat "${STAGE}/env${ENV_N}.out" >>"${STAGE}/config.out"
  consider "env${ENV_N}" "${f}" "${STAGE}/env${ENV_N}"
done
ADVISORIES=()
while IFS= read -r line; do case "${line}" in change:*) note "${line#change: }" ;; advisory:*) ADVISORIES+=("${line}") ;; esac; done < <(cat "${STAGE}/config.out" "${STAGE}/compose.out" "${STAGE}/plist.out")

# ---- keychain plan -------------------------------------------------------------------------------
KC_ACTION="none"
if ${HAS_LITERAL}; then
  if kc_has; then
    KEY_IN_CONFIG="$(find_key --print-key)"
    KEY_IN_KC="$(security find-generic-password "${KC_ARGS[@]}" -w 2>/dev/null || true)"
    [ "${KEY_IN_CONFIG}" = "${KEY_IN_KC}" ] || die "keychain item ${KC_SERVICE} exists but differs from the key in the files; refusing to overwrite it. Remove or rename one, then rerun." 3
    unset KEY_IN_CONFIG KEY_IN_KC
    KC_ACTION="present"
    note "keychain: item ${KC_SERVICE}/${KC_ACCOUNT} already holds this key (kept)"
  else
    KC_ACTION="add"
    note "keychain: store the key (${KEYSRC}) as ${KC_SERVICE}/${KC_ACCOUNT} via 'security -i' on stdin (value not shown)"
  fi
elif ! kc_has; then
  say "Where key-like settings live (values hidden):"
  "${EDIT[@]}" diagnose "${CONFIG}" "${COMPOSE}" ${ENVFILES[@]+"${ENVFILES[@]}"} | sed 's/^/  /'
  say "refused: no file holds a literal ${ENV_VAR}/api_key and keychain item ${KC_SERVICE}/${KC_ACCOUNT} does not exist."
  say "  Enter the key yourself (you are prompted; it never appears on a command line):"
  say "    security add-generic-password -U -s ${KC_SERVICE} -a ${KC_ACCOUNT} -w"
  exit 3
fi

# ---- production window gate for the restart -----------------------------------------------------
PROD_STATE="unobservable"
if command -v arcadia >/dev/null 2>&1; then
  # real output: "Managed production" then an indented state label such as "Inactive" or "Active · ..."
  PROD_STATE="$(arcadia production status 2>/dev/null | awk '/^Managed production/ { getline; sub(/^ +/, ""); print; exit }' || true)"
  [ -n "${PROD_STATE}" ] || PROD_STATE="unobservable"
fi

say ""
if [ "${#CHANGES[@]}" -eq 0 ] && [ "${#CHANGED_FILES[@]}" -eq 0 ]; then
  say "plan: no changes needed; the files already match."
else
  say "plan:"
  for c in ${CHANGES[@]+"${CHANGES[@]}"}; do say "  - ${c}"; done
  for entry in ${CHANGED_FILES[@]+"${CHANGED_FILES[@]}"}; do rest="${entry#*|}"; say "  - write ${rest%%|*} (backed up first if it exists)"; done
  say "  - restart: $(${NO_RESTART} && echo skipped || echo "reload launchd job ${LABEL} (or 'docker compose up -d' if it is not loaded); ports and env are fixed at container creation, so 'docker restart' cannot apply them")"
  say "  - production status: ${PROD_STATE}"
fi
for ((i = 0; i < ${#ADVISORIES[@]}; i++)); do say "  ${ADVISORIES[$i]}"; done

if ! ${APPLY}; then
  say ""
  say "Dry run only. To apply: $0 --budget-usd ${BUDGET} --budget-duration ${DURATION} --apply"
  exit 0
fi

# ---- apply ---------------------------------------------------------------------------------------
RESTORE=()
CHANGED_COUNT="${#CHANGED_FILES[@]}"
if [ "${CHANGED_COUNT}" -gt 0 ] && ! ${NO_RESTART} && ! ${IGNORE_WINDOW}; then
  case "${PROD_STATE}" in
    Inactive*) ;;
    *) die "managed production is '${PROD_STATE}'; a LiteLLM restart is deferred unless production reads Inactive. Rerun after production is Off, or pass --ignore-production-window to authorize this one interruption." 3 ;;
  esac
fi

if [ "${KC_ACTION}" = "add" ]; then
  KEY_VALUE="$(find_key --print-key)"
  [[ "${KEY_VALUE}" =~ ^[A-Za-z0-9_-]+$ ]] || die "the key has unexpected characters; enter it yourself: security add-generic-password -U -s ${KC_SERVICE} -a ${KC_ACCOUNT} -w" 3
  # builtin printf into a pipe: the value is on stdin only, never in any process's arguments
  printf 'add-generic-password -U -s "%s" -a "%s" -w "%s"\nquit\n' "${KC_SERVICE}" "${KC_ACCOUNT}" "${KEY_VALUE}" | security -i >/dev/null 2>&1 || true
  unset KEY_VALUE
  kc_has || die "the keychain write did not take; nothing was changed. Enter the key yourself: security add-generic-password -U -s ${KC_SERVICE} -a ${KC_ACCOUNT} -w" 3
  say "keychain: stored ${KC_SERVICE}/${KC_ACCOUNT}"
fi

for entry in ${CHANGED_FILES[@]+"${CHANGED_FILES[@]}"}; do
  name="${entry%%|*}"; rest="${entry#*|}"; real="${rest%%|*}"; staged="${rest#*|}"
  if [ -f "${real}" ]; then
    backup="${real}.bak.${STAMP}"
    cp -p "${real}" "${backup}"
    chmod 600 "${backup}"
    RESTORE+=("cp -p '${backup}' '${real}'")
    say "backup: ${backup}"
  else
    RESTORE+=("rm -f '${real}'")
  fi
  cp "${staged}" "${real}"
  [ "${name}" = "launcher" ] && chmod 700 "${real}"
  say "wrote: ${real}"
done

restore_line() {
  local out="" part
  for part in ${RESTORE[@]+"${RESTORE[@]}"}; do out="${out:+${out} && }${part}"; done
  [ -n "${out}" ] && printf '%s; launchctl bootout gui/%s/%s 2>/dev/null; launchctl bootstrap gui/%s %q\n' "${out}" "$(id -u)" "${LABEL}" "$(id -u)" "${PLIST}"
}

if [ "${CHANGED_COUNT}" -gt 0 ]; then
  say ""
  say "restore (one line):"
  say "$(restore_line)"
fi

# ---- restart -------------------------------------------------------------------------------------
UIDN="$(id -u)"
RESTART_FAILED=false
if [ "${CHANGED_COUNT}" -gt 0 ] && ! ${NO_RESTART}; then
  if launchctl print "gui/${UIDN}/${LABEL}" >/dev/null 2>&1; then
    say "restart: reloading launchd job ${LABEL}"
    launchctl bootout "gui/${UIDN}/${LABEL}" >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do launchctl print "gui/${UIDN}/${LABEL}" >/dev/null 2>&1 || break; sleep 1; done
    launchctl bootstrap "gui/${UIDN}" "${PLIST}" || RESTART_FAILED=true
  else
    say "restart: ${LABEL} is not loaded in launchd; running 'docker compose up -d' for the service"
    (
      cd "${DIR}"
      OPENAI_KEY_TMP="$(security find-generic-password "${KC_ARGS[@]}" -w)"
      export "${ENV_VAR}=${OPENAI_KEY_TMP}"
      "${DOCKER_BIN}" compose -f "${COMPOSE}" up -d
    ) >/dev/null || RESTART_FAILED=true
  fi
elif ${NO_RESTART}; then
  say "restart: skipped (--no-restart); the running container still has the old settings"
fi

# ---- verify --------------------------------------------------------------------------------------
FAIL=0
verify_fail() { say "VERIFY FAIL: $1"; FAIL=1; }
${RESTART_FAILED} && verify_fail "the restart command failed; the restore line printed above puts the old files back"
if ${NO_RESTART}; then
  say "verify: skipped (--no-restart)"
else
  alive=false
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 5 http://127.0.0.1:4000/health/liveliness >/dev/null 2>&1; then alive=true; break; fi
    sleep 2
  done
  if ${alive}; then say "verify ok: liveness http://127.0.0.1:4000/health/liveliness"; else verify_fail "liveness did not recover within 60 s"; fi

  NOW="$(listeners)"
  if [ -z "${NOW}" ]; then
    verify_fail "nothing is listening on TCP 4000"
  elif [ "${NOW}" = "127.0.0.1:4000" ]; then
    say "verify ok: listening only on 127.0.0.1:4000"
  else
    verify_fail "listeners on 4000 are not only 127.0.0.1:4000: $(printf '%s' "${NOW}" | tr '\n' ' ')"
  fi

  if "${DOCKER_BIN}" exec "${CONTAINER}" sh -c "[ -n \"\${${ENV_VAR}:-}\" ]" >/dev/null 2>&1; then
    say "verify ok: container ${CONTAINER} has ${ENV_VAR} set (value not read)"
  else
    verify_fail "container ${CONTAINER} has no ${ENV_VAR}; the key is not reaching the service"
  fi
fi

for f in "${CONFIG}" "${COMPOSE}" "${LAUNCHER}" "${PLIST}"; do
  if grep -Eq '(API_KEY|api_key)["'\'']?[:=] *["'\'']?sk-[A-Za-z0-9_-]{20,}' "${f}"; then verify_fail "${f} still contains a key-shaped literal"; fi
done
for f in ${ENVFILES[@]+"${ENVFILES[@]}"}; do
  if grep -Eq "^[[:space:]]*(export[[:space:]]+)?[\"']?${ENV_VAR}[\"']?[:=] *[\"']?sk-[A-Za-z0-9_-]{20,}" "${f}"; then verify_fail "${f} still contains a literal ${ENV_VAR}"; fi
done
[ "${FAIL}" -eq 0 ] && say "verify ok: no key-shaped api_key literal in config, compose, .env files, launcher or plist"
awk -v b="${BUDGET}" '/^litellm_settings:/ { f = 1; next } /^[^ #\t]/ { f = 0 } f && /^[ \t]+max_budget:/ { if ($2 + 0 == b + 0) ok = 1 } END { exit !ok }' "${CONFIG}" || verify_fail "max_budget is not ${BUDGET} under litellm_settings in the config"
kc_has && say "verify ok: keychain item ${KC_SERVICE}/${KC_ACCOUNT} exists" || verify_fail "keychain item missing"

say ""
[ "${CHANGED_COUNT}" -gt 0 ] || say "restore: nothing was changed, so there is nothing to restore."
if [ "${CHANGED_COUNT}" -gt 0 ]; then
  say "Notes: every backup is a copy of the old file, so the config backup (and any compose or plist backup) still contains the old key, which was exposed while port 4000 listened on all interfaces."
  say "  Rotate that key at the provider, put the new one in the keychain, then delete the old backup(s)."
  say "  Keychain access: launchd reads the item with /usr/bin/security; if the key prompt appears once, choose Always Allow."
fi
if [ "${FAIL}" -ne 0 ]; then exit 4; fi
say "harden-litellm: done"
