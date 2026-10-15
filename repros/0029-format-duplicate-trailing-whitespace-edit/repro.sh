#!/usr/bin/env bash
# Range and on-type formatting return the same trailing-whitespace delete twice when the range ends in comment trivia.
source "$(dirname "$0")/../../lib/common.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"

tsgo_install
make_workdir

cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "noEmit": true, "strict": true }, "include": ["src"] }
JSON
mkdir src
# Line 1 is two spaces: trailing whitespace between two comments that are leading trivia of `let`.
printf '// one\n  \n// two\nlet x = 1;\n' >src/a.ts

out="$(TSGO="$TSGO" node "$HERE/repro.mjs" "$WORKDIR")" || die "LSP client failed: $out"
echo "$out" | sed '$d'
read -r _ reproduced summary <<<"$(echo "$out" | tail -1)"
[[ "$reproduced" == 2 ]] && die "$summary"
verdict "$reproduced" "$summary"
