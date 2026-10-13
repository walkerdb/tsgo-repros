#!/usr/bin/env bash
# workspace/willRenameFiles on foo.d.css.ts also renames foo.css when the new name is not a .d.css.ts file.
source "$(dirname "$0")/../../lib/common.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"

tsgo_install
make_workdir

cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "noEmit": true, "strict": true, "module": "preserve", "allowArbitraryExtensions": true }, "include": ["src"] }
JSON
mkdir src
echo '.a { color: red }' >src/styles.css
echo 'declare const styles: { a: string }; export default styles;' >src/styles.d.css.ts
echo 'import styles from "./styles.css"; console.log(styles.a);' >src/index.ts

out="$(TSGO="$TSGO" node "$HERE/repro.mjs" "$WORKDIR")" || die "LSP client failed: $out"
echo "$out" | sed '$d'
read -r _ reproduced summary <<<"$(echo "$out" | tail -1)"
[[ "$reproduced" == 2 ]] && die "$summary"
verdict "$reproduced" "$summary"
