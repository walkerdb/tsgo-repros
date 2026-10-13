#!/usr/bin/env bash
# With a content mapper and no outDir, the declaration file written for a mapped file (`v.d.vue.ts` for `v.vue`)
# matches the include pattern, so the next build takes it as an input and fails with TS5055, and `tsc -b --watch`
# rebuilds in an endless loop.
source "$(dirname "$0")/../../lib/common.sh"

MAPPER_JS="$(cd "$(dirname "$0")" && pwd)/mapper.js"
tsgo_install
command -v node >/dev/null || die "node is required to run the content mapper"
make_workdir

# The project sits one level below the work directory, and has a package.json and `types: []`, so that tsgo's lookup
# watches stop at the project and file events from other work directories under .cache cannot start cycles.
mkdir -p proj/node_modules/verbatim-mapper
cd proj
cp "$MAPPER_JS" node_modules/verbatim-mapper/mapper.js
cat >node_modules/verbatim-mapper/package.json <<'JSON'
{ "name": "verbatim-mapper", "version": "1.0.0", "typescript": { "contentMapper": { "exec": ["node", "mapper.js"] } } }
JSON
echo '{}' >package.json
cat >tsconfig.json <<'JSON'
{
	"compilerOptions": { "declaration": true, "strict": true, "types": [] },
	"contentMappers": [{ "package": "verbatim-mapper", "extensions": [".vue"] }]
}
JSON
echo 'export const v: number = 1;' >v.vue
echo 'import { v } from "./v.vue"; export const m = v + 1;' >main.ts

reproduced=0
log 'tsc -b (first build):'
first=0
"$TSGO" -b --runExternalCode --pretty false >"$WORKDIR/first.txt" 2>&1 || first=$?
cat "$WORKDIR/first.txt" >&2
# Content mappers (tsconfig "contentMappers", --runExternalCode) are not in every version.
if grep -q 'TS5072' "$WORKDIR/first.txt"; then
	verdict 0 "this tsgo has no content mapper support (--runExternalCode: TS5072), so the bug cannot occur"
fi
log "exit $first; files: $(ls | tr '\n' ' ')"
[[ "$first" == 0 && -f v.d.vue.ts ]] || die "the first build failed or wrote no v.d.vue.ts; the mapper may not be working"

log 'input files now:'
"$TSGO" -p . --runExternalCode --listFilesOnly --pretty false 2>&1 | grep -v '/lib\.' >&2 || true

echo 'import { v } from "./v.vue"; export const m = v + 2;' >main.ts
log 'tsc -b after an edit to main.ts:'
second=0
"$TSGO" -b --runExternalCode --pretty false >"$WORKDIR/second.txt" 2>&1 || second=$?
cat "$WORKDIR/second.txt" >&2
log "exit $second"
ts5055="$(grep -c 'error TS5055' "$WORKDIR/second.txt" || true)"
(( ts5055 > 0 )) && reproduced=1

# Watch: start clean, edit once, and count cycles over a fixed window (the log may never settle).
summary="second tsc -b: exit $second, $ts5055 TS5055 errors; "
for mode in watch build; do
	if [[ "$mode" == watch ]]; then args=(-p .); label='tsc --watch'; else args=(-b .); label='tsc -b --watch'; fi
	rm -f main.js main.d.ts v.d.vue.ts tsconfig.tsbuildinfo
	echo 'import { v } from "./v.vue"; export const m = v + 1;' >main.ts
	watch_start "${args[@]}" --runExternalCode
	sleep 2
	before="$(watch_cycles)"
	echo 'import { v } from "./v.vue"; export const m = v + 3;' >main.ts
	sleep 5
	cycles=$(( $(watch_cycles) - before ))
	errors="$(grep -c 'error TS5055' "$WATCH_LOG" || true)"
	watch_stop
	head -40 "$WATCH_LOG" >&2
	log "$label: 1 edit: $cycles cycles in 5 s, $errors TS5055 reports"
	summary+="$label: $cycles cycles in 5 s after 1 edit, $errors TS5055; "
done

verdict "$reproduced" "${summary}expected exit 0 and 1 cycle per edit"
