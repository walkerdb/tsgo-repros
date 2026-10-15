#!/usr/bin/env bash
# A line that ends in U+2028 or U+2029 ends inside the break's UTF-8 encoding (folding ranges, JSDoc completions).
source "$(dirname "$0")/../../lib/common.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"

tsgo_install
make_workdir

cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "noEmit": true, "strict": true }, "include": ["src"] }
JSON
mkdir src
# repro.mjs writes the sources: each test has a \n file (the control) and U+2028 / U+2029 files, which are easier to
# write from Node than from bash.
out="$(TSGO="$TSGO" node "$HERE/repro.mjs" "$WORKDIR")" || die "LSP client failed: $out"
echo "$out" | sed '$d'
read -r _ reproduced summary <<<"$(echo "$out" | tail -1)"
[[ "$reproduced" == 2 ]] && die "$summary"
verdict "$reproduced" "$summary"
