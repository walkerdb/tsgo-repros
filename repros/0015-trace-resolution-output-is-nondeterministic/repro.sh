#!/usr/bin/env bash
# `tsc --traceResolution` prints different traces from run to run on the same project.
source "$(dirname "$0")/../../lib/common.sh"

tsgo_install
make_workdir

# 10 packages in node_modules, each imported by all 40 source files.
mkdir -p src node_modules
for p in $(seq 1 10); do
	mkdir "node_modules/pkg$p"
	echo "{ \"name\": \"pkg$p\", \"version\": \"1.0.0\", \"types\": \"index.d.ts\" }" >"node_modules/pkg$p/package.json"
	echo "export declare const v$p: number;" >"node_modules/pkg$p/index.d.ts"
done
for i in $(seq 1 40); do
	{
		for p in $(seq 1 10); do printf 'import { v%s } from "pkg%s";\n' "$p" "$p"; done
		printf 'export const s%s = v1;\n' "$i"
	} >"src/a$i.ts"
done
cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "strict": true, "noEmit": true, "types": [], "module": "nodenext" }, "include": ["src"] }
JSON

runs=10
found=()
for r in $(seq "$runs"); do
	"$TSGO" -p . --pretty false --traceResolution >"trace$r.txt" || die "tsgo failed"
	sort "trace$r.txt" >"sorted$r.txt"
	found+=("$(grep -c "^Found 'package.json'" "trace$r.txt" || true)")
done
distinct="$(md5sum trace*.txt | awk '{print $1}' | sort -u | wc -l)"
distinct_sorted="$(md5sum sorted*.txt | awk '{print $1}' | sort -u | wc -l)"
log "runs: $runs, distinct outputs: $distinct, distinct after sorting lines: $distinct_sorted"
log "\"Found 'package.json'\" lines per run: ${found[*]} (10 packages)"
if ! cmp -s trace1.txt trace2.txt; then
	log "first difference between run 1 and run 2:"
	diff trace1.txt trace2.txt | head -4 | sed "s#$WORKDIR#<project>#g" >&2 || true
fi

# Control: --singleThreaded.
for r in 1 2 3; do "$TSGO" -p . --pretty false --traceResolution --singleThreaded | md5sum; done >single.txt
log "--singleThreaded: $(sort -u single.txt | wc -l) distinct output(s) in 3 runs"

reproduced=0
(( distinct > 1 )) && reproduced=1
verdict "$reproduced" "$distinct distinct --traceResolution outputs in $runs runs ($distinct_sorted distinct after sorting lines); \"Found 'package.json'\" lines per run: ${found[*]}"
