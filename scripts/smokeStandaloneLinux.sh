#!/usr/bin/env sh
set -eu

binary=${1:-./release/OGrafStudioServer-linux-x64}
port=${2:-4398}
temporary_root=$(mktemp -d)
server_pid=''

cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf -- "$temporary_root"
}
trap cleanup EXIT INT TERM

"$binary" --port "$port" --workspace "$temporary_root/workspace" --no-open \
  >"$temporary_root/server.log" 2>&1 &
server_pid=$!

attempt=0
until curl -fsS "http://127.0.0.1:$port/health" >"$temporary_root/health.json"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    cat "$temporary_root/server.log"
    exit 1
  fi
  sleep 0.2
done

curl -fsS "http://127.0.0.1:$port/" | grep -q '<title>OGraf Studio</title>'
grep -q 'OGraf Studio 0.13 standalone server' "$temporary_root/server.log"
grep -q 'https://github.com/zerodensity/ograf-studio' "$temporary_root/server.log"
cat "$temporary_root/health.json"
printf '\nLinux standalone smoke test passed.\n'
