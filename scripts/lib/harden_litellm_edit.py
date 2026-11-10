#!/usr/bin/env python3
"""Text edits for scripts/harden-litellm.sh. Standard library only.

Every subcommand reads one file, writes the edited text to OUT and prints one
`change: ...` line per edit. It never prints a key value. Exit 3 means the file
is shaped in a way this helper will not guess at; nothing is written then.

  config-key  CONFIG [--print-key]       exit 0 when a literal key exists; print it to stdout only with --print-key
  config-edit CONFIG OUT --env-var N --budget X --duration D
  compose-edit COMPOSE OUT --container C --env-var N
  plist-edit PLIST OUT --launcher PATH
"""
import argparse
import plistlib
import re
import sys

KEY_LINE = re.compile(r"""^(\s*(?:-\s*)?)api_key:\s*(["']?)(sk-[A-Za-z0-9_\-]{20,})\2\s*(#.*)?$""")
MASTER_LINE = re.compile(r"""^\s*master_key:\s*["']?(?!os\.environ)[^\s"'#]+""")
INDENT = re.compile(r"^(\s*)")


def refuse(message):
    sys.stderr.write("refused: " + message + "\n")
    sys.exit(3)


def read_lines(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read().split("\n")


def write_lines(path, lines):
    text = "\n".join(lines)
    if not text.endswith("\n"):
        text += "\n"
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def indent_of(line):
    return len(INDENT.match(line).group(1))


def is_blank_or_comment(line):
    stripped = line.strip()
    return stripped == "" or stripped.startswith("#")


def continues(line, child):
    """True while a line still belongs to a key written at indent `child` (list items may sit at the key's indent)."""
    here = indent_of(line)
    return here > child or (here == child and line.lstrip().startswith("-"))


ANY_KEY = re.compile(r"""api_key["']?\s*:\s*["']?sk-[A-Za-z0-9_\-]{20,}""")


def check_shapes(lines):
    for line in lines:
        if ANY_KEY.search(line) and not KEY_LINE.match(line):
            refuse("a literal api_key is written in a form this script will not rewrite (flow style, inline or commented out); move or delete it by hand")


def config_keys(lines):
    return [m.group(3) for m in (KEY_LINE.match(line) for line in lines) if m]


def cmd_config_key(args):
    all_lines = read_lines(args.file)
    check_shapes(all_lines)
    keys = set(config_keys(all_lines))
    if len(keys) > 1:
        refuse("more than one distinct literal api_key; move them by hand")
    if args.print_key and keys:
        sys.stdout.write(next(iter(keys)))
    sys.exit(0 if keys else 1)


def cmd_config_edit(args):
    lines = read_lines(args.file)
    check_shapes(lines)
    if len({k for k in config_keys(lines)}) > 1:
        refuse("more than one distinct literal api_key; move them by hand")
    changes = []
    replaced = 0
    for i, line in enumerate(lines):
        m = KEY_LINE.match(line)
        if m:
            lines[i] = m.group(1) + "api_key: os.environ/" + args.env_var
            replaced += 1
    if replaced:
        changes.append("config: replace %d literal api_key value(s) with os.environ/%s (value not shown)" % (replaced, args.env_var))
    if any(MASTER_LINE.match(line) for line in lines):
        print("advisory: master_key is a literal in the config; not changed by this script")

    # global budget under litellm_settings
    want = {"max_budget": args.budget, "budget_duration": args.duration}
    start = next((i for i, l in enumerate(lines) if re.match(r"^litellm_settings:\s*(#.*)?$", l)), None)
    if start is None:
        if any(re.match(r"^litellm_settings:\s*\S", l) for l in lines):
            refuse("litellm_settings is written in flow style; edit it by hand")
        while lines and lines[-1].strip() == "":
            lines.pop()
        lines += ["", "litellm_settings:", "  max_budget: " + args.budget, "  budget_duration: " + args.duration]
        changes.append("config: add litellm_settings max_budget %s, budget_duration %s" % (args.budget, args.duration))
    else:
        end = len(lines)
        for j in range(start + 1, len(lines)):
            if not is_blank_or_comment(lines[j]) and indent_of(lines[j]) == 0:
                end = j
                break
        while end > start + 1 and is_blank_or_comment(lines[end - 1]):
            end -= 1
        child = next((indent_of(lines[j]) for j in range(start + 1, end) if not is_blank_or_comment(lines[j])), 2)
        pad = " " * child
        for key, value in want.items():
            pattern = re.compile(r"^" + pad + re.escape(key) + r":\s*(\S+?)\s*(#.*)?$")
            found = next((j for j in range(start + 1, end) if pattern.match(lines[j])), None)
            if found is None:
                lines.insert(end, "%s%s: %s" % (pad, key, value))
                end += 1
                changes.append("config: add litellm_settings %s: %s" % (key, value))
                continue
            current = pattern.match(lines[found]).group(1).strip("\"'")
            same = False
            try:
                same = float(current) == float(value) if key == "max_budget" else current == value
            except ValueError:
                same = False
            if not same:
                lines[found] = "%s%s: %s" % (pad, key, value)
                changes.append("config: set litellm_settings %s: %s (was %s)" % (key, value, current))
    write_lines(args.out, lines)
    for change in changes:
        print("change: " + change)


def cmd_compose_edit(args):
    lines = read_lines(args.file)
    services = next((i for i, l in enumerate(lines) if re.match(r"^services:\s*(#.*)?$", l)), None)
    if services is None:
        refuse("no top-level services: key in the compose file")
    svc_indent = next((indent_of(lines[j]) for j in range(services + 1, len(lines)) if not is_blank_or_comment(lines[j])), None)
    if svc_indent is None:
        refuse("services: is empty")
    heads = [j for j in range(services + 1, len(lines)) if not is_blank_or_comment(lines[j]) and indent_of(lines[j]) == svc_indent and lines[j].strip().endswith(":")]
    block = None
    for n, head in enumerate(heads):
        stop = heads[n + 1] if n + 1 < len(heads) else len(lines)
        limit = stop
        for j in range(head + 1, stop):
            if not is_blank_or_comment(lines[j]) and indent_of(lines[j]) < svc_indent:
                limit = j
                break
        if any(re.match(r"^\s*container_name:\s*[\"']?%s[\"']?\s*(#.*)?$" % re.escape(args.container), lines[j]) for j in range(head + 1, limit)):
            block = (head, limit)
            break
    if block is None:
        refuse("no service with container_name: %s" % args.container)
    head, limit = block
    name = lines[head].strip().rstrip(":")
    print("service: " + name)
    changes = []
    child = next((indent_of(lines[j]) for j in range(head + 1, limit) if not is_blank_or_comment(lines[j])), svc_indent + 2)
    pad = " " * child

    # ports: bind host port 4000 to 127.0.0.1 only
    ports_at = next((j for j in range(head + 1, limit) if re.match(r"^" + pad + r"ports:\s*(#.*)?$", lines[j])), None)
    if ports_at is None:
        refuse("service %s has no ports: list; nothing to bind" % name)
    seen = False
    for j in range(ports_at + 1, limit):
        if is_blank_or_comment(lines[j]):
            continue
        if not continues(lines[j], child):
            break
        m = re.match(r"^(\s*-\s*)([\"']?)(?:(\d{1,3}(?:\.\d{1,3}){3}):)?4000:(\d+)(/\w+)?\2\s*(#.*)?$", lines[j])
        if not m:
            continue
        seen = True
        if m.group(3) == "127.0.0.1":
            continue
        lines[j] = "%s%s127.0.0.1:4000:%s%s%s" % (m.group(1), m.group(2), m.group(4), m.group(5) or "", m.group(2))
        changes.append("compose: bind host port 4000 to 127.0.0.1 (was %s)" % (m.group(3) or "all interfaces"))
    if not seen:
        refuse("no short-syntax 4000:<port> mapping found under ports:; edit it by hand")

    # environment: pass the variable through from the host environment, never a value
    env_at = next((j for j in range(head + 1, limit) if re.match(r"^" + pad + r"environment:\s*(#.*)?$", lines[j])), None)
    if env_at is None:
        if any(re.match(r"^" + pad + r"environment:\s*\S", lines[j]) for j in range(head + 1, limit)):
            refuse("environment: is written inline; edit it by hand")
        last = max(j for j in range(head, limit) if not is_blank_or_comment(lines[j]))
        lines[last + 1:last + 1] = [pad + "environment:", pad + "  - " + args.env_var]
        changes.append("compose: add environment pass-through %s (no value)" % args.env_var)
    else:
        items = [j for j in range(env_at + 1, limit) if not is_blank_or_comment(lines[j])]
        run = []
        for j in items:
            if not continues(lines[j], child):
                break
            run.append(j)
        if not run:
            refuse("environment: block is empty or unusual; edit it by hand")
        is_list = lines[run[0]].lstrip().startswith("-")
        var = re.escape(args.env_var)
        done = False
        for j in run:
            if is_list:
                m = re.match(r"^(\s*-\s*)([\"']?)" + var + r"(?:=.*)?\2\s*(#.*)?$", lines[j])
                if m:
                    done = True
                    if "=" in lines[j]:
                        lines[j] = "%s%s%s" % (m.group(1), m.group(2), args.env_var) + m.group(2)
                        changes.append("compose: replace literal %s value with pass-through (value not shown)" % args.env_var)
            else:
                m = re.match(r"^(\s*)" + var + r":\s*(.*)$", lines[j])
                if m:
                    done = True
                    if m.group(2).strip() not in ("", "~", "null"):
                        lines[j] = "%s%s:" % (m.group(1), args.env_var)
                        changes.append("compose: replace literal %s value with pass-through (value not shown)" % args.env_var)
        if not done:
            ipad = " " * indent_of(lines[run[0]])
            lines.insert(run[-1] + 1, ipad + ("- " + args.env_var if is_list else args.env_var + ":"))
            changes.append("compose: add environment pass-through %s (no value)" % args.env_var)
    write_lines(args.out, lines)
    for change in changes:
        print("change: " + change)


def cmd_plist_edit(args):
    with open(args.file, "rb") as handle:
        data = plistlib.load(handle)
    program = data.get("ProgramArguments")
    if not isinstance(program, list) or not program:
        refuse("plist has no ProgramArguments")
    print("docker: " + program[0] if program[0].endswith("/docker") else "docker: ")
    changes = []
    if program != [args.launcher]:
        data["ProgramArguments"] = [args.launcher]
        changes.append("plist: ProgramArguments -> [%s] (was %s)" % (args.launcher, " ".join(program)))
    with open(args.out, "wb") as handle:
        plistlib.dump(data, handle, fmt=plistlib.FMT_XML)
    for change in changes:
        print("change: " + change)


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("config-key")
    p.add_argument("file")
    p.add_argument("--print-key", action="store_true")
    p.set_defaults(fn=cmd_config_key)
    p = sub.add_parser("config-edit")
    p.add_argument("file")
    p.add_argument("out")
    p.add_argument("--env-var", required=True)
    p.add_argument("--budget", required=True)
    p.add_argument("--duration", required=True)
    p.set_defaults(fn=cmd_config_edit)
    p = sub.add_parser("compose-edit")
    p.add_argument("file")
    p.add_argument("out")
    p.add_argument("--container", required=True)
    p.add_argument("--env-var", required=True)
    p.set_defaults(fn=cmd_compose_edit)
    p = sub.add_parser("plist-edit")
    p.add_argument("file")
    p.add_argument("out")
    p.add_argument("--launcher", required=True)
    p.set_defaults(fn=cmd_plist_edit)
    args = parser.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
