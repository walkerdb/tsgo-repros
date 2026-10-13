#!/usr/bin/env bash
# `tsc --watch` and `tsc -b --watch` start a build when any new directory appears in a watched directory, even one that
# no include pattern or module lookup can match (here `mkdir notes` beside `src`, with `include: ["src"]`).
source "$(dirname "$0")/../../lib/common.sh"

tsgo_install
make_workdir

# The project sits one level below the work directory, and has a package.json and `types: []`, so that tsgo's lookup
# watches stop at the project and file events from other work directories under .cache cannot start cycles.
mkdir -p proj/src
cd proj
echo '{}' >package.json
cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "noEmit": true, "strict": true, "types": [] }, "include": ["src"] }
JSON
echo 'export const a: number = 1;' >src/a.ts

reproduced=0
summary=""
for mode in watch build; do
	if [[ "$mode" == watch ]]; then args=(-p .); label='tsc --watch'; else args=(-b .); label='tsc -b --watch'; fi
	watch_start "${args[@]}"
	watch_settle 2

	# Control: a quiet period as long as one mkdir measurement starts nothing.
	before="$(watch_cycles)"
	watch_settle 2
	quiet=$(( $(watch_cycles) - before ))

	results=()
	for i in 1 2 3; do
		before="$(watch_cycles)"
		mkdir "notes-$mode-$i"
		watch_settle 2
		results+=($(( $(watch_cycles) - before )))
	done
	watch_stop
	cat "$WATCH_LOG" >&2
	min="$(printf '%s\n' "${results[@]}" | sort -n | head -1)"
	log "$label: cycles in a quiet period: $quiet; cycles after each mkdir: ${results[*]}"
	summary+="$label: ${results[*]} cycles after 3 mkdirs (quiet period: $quiet); "
	(( quiet == 0 && min > 0 )) && reproduced=1
done

verdict "$reproduced" "${summary}expected 0"
