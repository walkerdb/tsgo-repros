#!/usr/bin/env bash
# `tsc --watch` starts a cycle on the first event of a save, so a save written in pieces is compiled half-written: the
# watch reports errors the saved file does not have, then compiles again.
source "$(dirname "$0")/../../lib/common.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"

command -v node >/dev/null || die "node is required to write files in timed pieces"
tsgo_install
make_workdir

# The project sits one level below the work directory, and has a package.json and `types: []`, so that tsgo's lookup
# watches stop at the work directory and file events from other work directories under .cache cannot start cycles.
mkdir -p proj/src
cd proj
echo '{ "type": "module" }' >package.json
cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "noEmit": true, "strict": true, "types": [] }, "include": ["src"] }
JSON
echo 'import { b } from "./b.js"; export const a: number = b;' >src/a.ts
echo 'export const b: number = 1;' >src/b.ts

# Each save pattern: truncate the file, then write the new text in N pieces with a pause before each piece.
# "pause_ms pieces" pairs. 0 ms is a normal one-shot save (open with O_TRUNC, write, close).
patterns=("0 1" "5 1" "300 1" "100 4")
saves_per_pattern=3

# Prints the diagnostics of each cycle started after line $1 of the watch log, one cycle per line ("-" for none).
cycle_reports() {
	tail -n +"$1" "$WATCH_LOG" | awk '
		/File change detected/ { if (n++) print (out == "" ? "-" : out); out = "" }
		/error TS/ { sub(/^.*error /, ""); out = out (out == "" ? "" : " | ") $0 }
		END { if (n) print (out == "" ? "-" : out) }'
}

reproduced=0
summary=""
for mode in watch build; do
	if [[ "$mode" == watch ]]; then args=(-p .); label='tsc --watch'; else args=(-b .); label='tsc -b --watch'; fi
	watch_start "${args[@]}"
	watch_settle 1
	results=()
	value=1
	for pattern in "${patterns[@]}"; do
		read -r pause pieces <<<"$pattern"
		total_cycles=0
		wrong=0
		for _ in $(seq "$saves_per_pattern"); do
			value=$((value + 1))
			text="export const b: number = $value; // saved with $pieces piece(s), $pause ms apart"
			start_line=$(( $(wc -l <"$WATCH_LOG") + 1 ))
			node "$HERE/write-pieces.js" src/b.ts "$pause" "$pieces" "$text"
			watch_settle 1
			# Every cycle should report what a fresh build of the final text reports: no errors.
			mapfile -t reports < <(cycle_reports "$start_line")
			total_cycles=$((total_cycles + ${#reports[@]}))
			for r in "${reports[@]}"; do
				if [[ "$r" != - ]]; then
					wrong=$((wrong + 1))
					log "$label: pause $pause ms x $pieces: a cycle reported: $r"
				fi
			done
		done
		fresh="$("$TSGO" -p . --noEmit --pretty false 2>&1 | grep -c 'error TS' || true)"
		(( fresh == 0 )) || die "a fresh build of the final text has $fresh errors; the test project is broken"
		(( wrong > 0 )) && reproduced=1
		results+=("${pause}ms x ${pieces}: $total_cycles cycles / $saves_per_pattern saves, $wrong with wrong errors;")
		log "$label: pause $pause ms x $pieces pieces: $total_cycles cycles for $saves_per_pattern saves, $wrong cycles with errors (fresh build: 0)"
	done
	watch_stop
	summary+="$label: ${results[*]} "
done

verdict "$reproduced" "${summary}(expected 1 cycle per save and 0 errors)"
