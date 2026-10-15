#!/usr/bin/env bash
# workspace/willRenameFiles with two files returns two different edits for the same import when the importer and its import move together.
source "$(dirname "$0")/../../lib/common.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"

tsgo_install
make_workdir

cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "noEmit": true, "strict": true, "module": "nodenext" }, "include": ["src"] }
JSON
mkdir src
echo 'export const b = 1;' >src/b.ts
echo 'import { b } from "./b.js"; console.log(b);' >src/a.ts

out="$(TSGO="$TSGO" node "$HERE/repro.mjs" "$WORKDIR")" || die "LSP client failed: $out"
echo "$out" | sed '$d'
read -r _ reproduced summary <<<"$(echo "$out" | tail -1)"
[[ "$reproduced" == 2 ]] && die "$summary"
verdict "$reproduced" "$summary"
