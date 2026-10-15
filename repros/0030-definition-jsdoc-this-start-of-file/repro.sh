#!/usr/bin/env bash
# Go to definition on a `this` that a JSDoc @this tag declares returns the start of the file.
source "$(dirname "$0")/../../lib/common.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"

tsgo_install
make_workdir

cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "noEmit": true, "strict": true, "allowJs": true, "checkJs": true }, "include": ["src"] }
JSON
mkdir src
# /*1*/ is the bug: `this` declared by @this in a JS file. /*2*/ is the control: `this` declared by a TS this parameter.
cat >src/a.js <<'JS'
// Line 0 is this comment, so a result here points at nothing.
class Foo {
	constructor() {
		this.x = 1;
	}
}

/** @this {Foo} */
function f() {
	return /*1*/this.x;
}
JS
cat >src/b.ts <<'TS'
// Line 0 is this comment, so a result here points at nothing.
class Foo {
	x = 1;
}

function f(this: Foo) {
	return /*2*/this.x;
}
TS

out="$(TSGO="$TSGO" node "$HERE/repro.mjs" "$WORKDIR")" || die "LSP client failed: $out"
echo "$out" | sed '$d'
read -r _ reproduced summary <<<"$(echo "$out" | tail -1)"
[[ "$reproduced" == 2 ]] && die "$summary"
verdict "$reproduced" "$summary"
