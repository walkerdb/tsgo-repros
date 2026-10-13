#!/usr/bin/env bash
# `tsc --watch` and `tsc -b --watch` never see edits to files reached through a symlinked directory under a
# recursively watched include directory.
source "$(dirname "$0")/../../lib/common.sh"

tsgo_install
make_workdir

# The project sits one level below the work directory, and has a package.json and `types: []`, so that tsgo's lookup
# watches stop at the work directory and file events from other work directories under .cache cannot start cycles.
mkdir -p proj/src proj/shared
cd proj
echo '{ "type": "module" }' >package.json
cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "noEmit": true, "strict": true, "types": [] }, "include": ["src"] }
JSON
echo 'import { b } from "./linked/b.js"; export const a: number = b;' >src/a.ts
ln -s ../shared src/linked

# Prints the diagnostics of the last build reported by the watch.
last_report() {
	awk '/Starting compilation|File change detected/ { out = "" } /error TS/ { out = out $0 "\n" } END { printf "%s", out }' "$WATCH_LOG"
}

reproduced=0
summary=""
for mode in watch build; do
	echo 'export const b: number = 1;' >shared/b.ts
	if [[ "$mode" == watch ]]; then args=(-p .); label='tsc --watch'; else args=(-b .); label='tsc -b --watch'; fi
	watch_start "${args[@]}"
	watch_settle 1
	log "$label: first build: $(last_report | wc -l) errors"

	results=()
	for edit in real link; do
		if [[ "$edit" == real ]]; then file=shared/b.ts; else file=src/linked/b.ts; fi
		before="$(watch_cycles)"
		echo "export const b: string = \"$edit\"; // edited through $file" >"$file"
		watch_settle 2
		cycles=$(( $(watch_cycles) - before ))
		errors="$(last_report | grep -c 'TS2322' || true)"
		log "$label: edit $file: $cycles cycles, last report has $errors TS2322 errors (a fresh build has 1)"
		results+=("$edit-path edit $cycles cycles,")
		(( cycles == 0 )) && reproduced=1
	done

	# Control: an edit to a file in the real src directory starts a cycle, which then picks up the missed edits.
	before="$(watch_cycles)"
	echo '// touched' >>src/a.ts
	watch_settle 2
	log "$label: control edit src/a.ts: $(( $(watch_cycles) - before )) cycles; reported:"
	last_report >&2
	results+=("control edit $(( $(watch_cycles) - before )) cycles")
	watch_stop
	summary+="$label: ${results[*]}; "
	cat "$WATCH_LOG" >&2
done

log "fresh build:"
"$TSGO" -p . --pretty false >&2 || true

verdict "$reproduced" "${summary}expected 1 cycle per edit"
