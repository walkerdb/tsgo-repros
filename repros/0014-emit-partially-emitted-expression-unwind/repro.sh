#!/usr/bin/env bash
# Nested type assertions: emit reorders comments and moves a source map end, unlike TypeScript 5.9.
source "$(dirname "$0")/../../lib/common.sh"
command -v node >/dev/null || die "node is required to decode the source map"

tsgo_install
make_workdir

cat >k.ts <<'TS'
declare const x: unknown;
export function k() {
	return (
		(x) as any
		// k4
	) /*t*/ as string;
}
TS
cat >q.ts <<'TS'
declare const x: unknown;
export const q = (
	(x) as any
	// q1
) as string;
TS
cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "target": "es2022", "module": "esnext", "sourceMap": true, "outDir": "out" }, "files": ["k.ts", "q.ts"] }
JSON
"$TSGO" -p . --pretty false || die "tsgo failed"

# What TypeScript 5.9.3 emits for k.ts with this tsconfig: the comments in source order.
expected_k='export function k() {
    return (x)
    // k4
    /*t*/;
}
//# sourceMappingURL=k.js.map'
actual_k="$(cat out/k.js)"
log "out/k.js:"
cat out/k.js >&2

# The source position that the end of the emitted `(x)` (line 1, column 20 of q.js) maps to. TypeScript 5.9.3 maps
# it to 3:11 (1-based line, 0-based column), the end of `(x) as any`.
actual_q="$(node - out/q.js.map <<'JS'
const map = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const B = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function vlq(s) {
	const out = []; let v = 0, sh = 0;
	for (const ch of s) { const d = B.indexOf(ch); v += (d & 31) << sh; if (d & 32) sh += 5; else { out.push(v & 1 ? -(v >> 1) : v >> 1); v = 0; sh = 0; } }
	return out;
}
let sl = 0, sc = 0, found = "none";
map.mappings.split(";").forEach((line, gl) => {
	let gc = 0;
	for (const seg of line.split(",")) {
		if (!seg) continue;
		const f = vlq(seg); gc += f[0];
		if (f.length > 1) { sl += f[2]; sc += f[3]; if (gl + 1 === 1 && gc === 20) found = `${sl + 1}:${sc}`; }
	}
});
console.log(found);
JS
)"
log "q.js 1:20 (end of the emitted \`(x)\`) maps to q.ts $actual_q; TypeScript 5.9.3 maps it to 3:11"

reproduced=0 what=()
if [[ "$actual_k" != "$expected_k" ]]; then
	reproduced=1
	what+=("k.js has /*t*/ on line $(grep -n '/\*t\*/' out/k.js | cut -d: -f1) before // k4 on line $(grep -n '// k4' out/k.js | cut -d: -f1) (5.9.3: // k4 first);")
fi
if [[ "$actual_q" != "3:11" ]]; then
	reproduced=1
	what+=("q.js 1:20 maps to q.ts $actual_q (5.9.3: 3:11)")
fi
verdict "$reproduced" "${what[*]:-k.js and the q.js mapping match TypeScript 5.9.3}"
