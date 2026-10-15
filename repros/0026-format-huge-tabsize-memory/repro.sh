#!/usr/bin/env bash
# textDocument/formatting with a huge tabSize builds indentation strings of that many spaces; tabSize 1e9 needs gigabytes.
source "$(dirname "$0")/../../lib/common.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"

tsgo_install
make_workdir

cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "noEmit": true, "strict": true }, "include": ["src"] }
JSON
mkdir src
printf 'function f() {\nreturn 1;\n}\n' >src/a.ts

# repro.mjs runs each server under a watchdog: SIGKILL once its RSS passes 2 GB or after 20 s.
out="$(TSGO="$TSGO" node "$HERE/repro.mjs" "$WORKDIR")" || die "LSP client failed: $out"
echo "$out" | sed '$d'
read -r _ reproduced summary <<<"$(echo "$out" | tail -1)"
[[ "$reproduced" == 2 ]] && die "$summary"
verdict "$reproduced" "$summary"
