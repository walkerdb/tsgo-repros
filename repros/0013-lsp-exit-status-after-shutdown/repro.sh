#!/usr/bin/env bash
# After a clean shutdown request and exit notification, the language server exits with status 1 ("context canceled").
source "$(dirname "$0")/../../lib/common.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"

tsgo_install
make_workdir

cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "noEmit": true, "strict": true }, "include": ["src"] }
JSON
mkdir src
echo 'export const a: number = 1;' >src/a.ts

out="$(TSGO="$TSGO" node "$HERE/repro.mjs" "$WORKDIR")" || die "LSP client failed: $out"
echo "$out" | sed '$d'
read -r _ reproduced summary <<<"$(echo "$out" | tail -1)"
verdict "$reproduced" "$summary"
