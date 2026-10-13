#!/usr/bin/env bash
# `tsc --watch` starts a second build after every edit, because the files the first build writes (outDir outputs,
# .tsbuildinfo) are inside the watched include directory and count as changes.
source "$(dirname "$0")/../../lib/common.sh"

tsgo_install
make_workdir

# Each case is a project one level below the work directory, with a package.json and `types: []`, so that tsgo's
# lookup watches stop at the project and file events from other work directories under .cache cannot start cycles.
# The default include ("**/*") covers the whole project directory, so outputs written there are inside it.
setup_project() {
	local dir="$1" options="$2"
	mkdir -p "$dir"
	echo '{}' >"$dir/package.json"
	echo "{ \"compilerOptions\": { $options, \"strict\": true, \"types\": [] } }" >"$dir/tsconfig.json"
	echo 'export const a: number = 0;' >"$dir/a.ts"
	echo 'import { a } from "./a"; export const b = a + 1;' >"$dir/b.ts"
}

# Runs a watch in project $1 with the given tsgo arguments, edits a.ts 3 times, and sets CYCLES to the cycle counts.
run_edits() {
	local dir="$1"; shift
	cd "$dir"
	watch_start "$@"
	cd "$WORKDIR"
	watch_settle 2
	CYCLES=()
	local i before
	for i in 1 2 3; do
		before="$(watch_cycles)"
		echo "export const a: number = $i;" >"$dir/a.ts"
		watch_settle 2
		CYCLES+=($(( $(watch_cycles) - before )))
	done
	watch_stop
	cat "$WATCH_LOG" >&2
}

reproduced=0
summary=""
for case in outdir tsbuildinfo; do
	if [[ "$case" == outdir ]]; then
		options='"outDir": "out", "declaration": true'
	else
		options='"noEmit": true, "incremental": true'
	fi
	setup_project "$case" "$options"
	for mode in watch build; do
		if [[ "$mode" == watch ]]; then args=(-p .); label='tsc --watch'; else args=(-b .); label='tsc -b --watch'; fi
		log "$case ($options): $label"
		run_edits "$case" "${args[@]}"
		min="$(printf '%s\n' "${CYCLES[@]}" | sort -n | head -1)"
		log "$case: $label: cycles per edit: ${CYCLES[*]}"
		summary+="$case $label: ${CYCLES[*]} cycles per edit; "
		(( min > 1 )) && reproduced=1
	done
	log "$case: files after the run: $(cd "$case" && find . -newer package.json -type f | sort | tr '\n' ' ')"
done

verdict "$reproduced" "${summary}expected 1 cycle per edit"
