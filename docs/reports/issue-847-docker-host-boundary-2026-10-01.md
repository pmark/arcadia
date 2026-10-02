# Issue 847 Docker host-boundary probe

This is a bounded host experiment, not activation evidence. The installed
`arcadia-unattended` profile, broker readiness gate, PPN candidate, and
production authority were not changed.

## Result

Docker Desktop's daemon was available on `desktop-linux` (Docker `29.1.5`).
A fixed, no-network container establishes the containment property that the
host Seatbelt/process-group preparation lacked:

```sh
docker run -d --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --pids-limit 64 --entrypoint /bin/sh postgres:15 \
  -c 'setsid sleep 300 & echo $!; sleep 300'
docker top <container> -eo pid,ppid,pgid,comm,args
docker rm --force <container>
docker inspect <container>
```

The observed container was
`0a5d63883196849fd52a0500e4b52531ada787be3437af93d588324e0e72e594`.
Its `setsid sleep 300` child had a distinct process group from PID 1, proving
the test actually attempted the native-child escape that defeated the prior
host process-group boundary. `docker rm --force` removed the container; a
subsequent inspect failed. Container lifecycle cleanup therefore contains this
child, unlike signalling only the host worker group.

## Unmet prerequisite

No local fixed Chromium/Lighthouse image was available. Attempts to acquire
`mcr.microsoft.com/playwright:v1.61.1-noble` and `hello-world:latest` made no
progress after three thirty-second observations; no target image appeared in
`docker image inspect`. The invocations remained stuck rather than returning a
registry error and were terminated by their exact PIDs. This proves neither
static preview, Chromium, nor Lighthouse inside a container.

The next implementation pass must use a reviewed, locally available immutable
browser-audit image (or repair the host registry route), then run the fixed
container with a read-only hashed static snapshot, `--network none`, no Docker
socket mount, bounded timeout/removal, and a real Lighthouse receipt. Until
then, the container result is only evidence that a viable containment primitive
exists; it is not a dispatch route or an approval to measure PPN.
