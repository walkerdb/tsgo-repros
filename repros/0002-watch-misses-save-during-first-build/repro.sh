#!/usr/bin/env bash
# `tsc --watch` starts watching only after the first build, so a file saved during the first build, after the build
# read it, has no event: the watch keeps reporting the old file's diagnostics.
source "$(dirname "$0")/../../lib/common.sh"

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
echo 'export const c = 1;' >src/c.ts
# big.ts takes about 3 s to check (each assignment is checked against a 1000-member union) but well under 100 ms to
# parse, so a.ts has been read long before the first build ends.
node -e '
	const n = 1000, m = 4000;
	let s = "type U = " + Array.from({ length: n }, (_, i) => `{ p${i}: number; q${i}: string }`).join(" | ") + ";\n";
	for (let i = 0; i < m; i++) s += `export const x${i}: U = { p${(i * 7) % n}: ${i}, q${(i * 7) % n}: "s" };\n`;
	require("fs").writeFileSync("src/big.ts", s);
'

good='export const a: number = 1;'
bad='export const a: number = "saved during the first build";'

# Prints the diagnostics of the last build reported by the watch.
last_report() {
	awk '/Starting compilation|File change detected/ { out = "" } /error TS/ { out = out $0 "\n" } END { printf "%s", out }' "$WATCH_LOG"
}

# Waits (up to 30 s) until the watch has finished more builds than $1, then for the log to go quiet.
wait_builds_done() {
	local i
	for i in $(seq 300); do
		(( $(grep -c 'Watching for file changes' "$WATCH_LOG") > $1 )) && break
		sleep 0.1
	done
	watch_settle 1
}

reproduced=0
summary=""
for mode in watch build; do
	if [[ "$mode" == watch ]]; then args=(-p .); label='tsc --watch'; else args=(-b .); label='tsc -b --watch'; fi
	delay=1
	outcome=""
	# The save must land after a.ts was read and before watching started. Retry with another delay if it did not.
	for attempt in 1 2 3 4; do
		echo "$good" >src/a.ts
		rm -f ./*.tsbuildinfo
		(sleep "$delay"; echo "$bad" >src/a.ts) &
		saver=$!
		start=$(date +%s%N)
		watch_start "${args[@]}"
		first_ms=$(( ($(date +%s%N) - start) / 1000000 ))
		wait "$saver"
		first_errors="$(grep -c 'TS2322' "$WATCH_LOG" || true)"
		watch_settle 3
		cycles="$(watch_cycles)"
		if (( first_errors > 0 )); then
			outcome="too early"
		elif (( cycles > 0 )); then
			outcome="too late"
		else
			outcome="missed"
		fi
		log "$label attempt $attempt: first build ${first_ms} ms, save after $delay s: $outcome ($cycles cycles, first build errors $first_errors)"
		[[ "$outcome" == missed ]] && break
		watch_stop
		if [[ "$outcome" == "too early" ]]; then delay=$(echo "$delay * 1.5" | bc); else delay=$(echo "scale=2; $delay / 2" | bc); fi
	done
	if [[ "$outcome" != missed ]]; then
		summary+="$label: could not place the save inside the first build ($outcome); "
		watch_stop
		continue
	fi
	reproduced=1
	reported="$(last_report | grep -c 'TS2322' || true)"
	fresh="$("$TSGO" -p . --noEmit --pretty false 2>&1 | grep -c 'TS2322' || true)"
	(( fresh == 1 )) || die "a fresh build reports $fresh TS2322 errors, expected 1"

	# Another file's save starts a cycle. Does it pick up the missed save?
	before="$(watch_cycles)"
	builds="$(grep -c 'Watching for file changes' "$WATCH_LOG")"
	echo 'export const c = 2;' >src/c.ts
	wait_builds_done "$builds"
	after_other="$(last_report | grep -c 'TS2322' || true)"
	log "$label: after saving src/c.ts: $(( $(watch_cycles) - before )) cycles, reported TS2322 errors: $after_other"
	cat "$WATCH_LOG" >&2
	watch_stop
	summary+="$label: save during the first build started 0 cycles, watch reports $reported TS2322 errors, fresh build $fresh, after saving another file $after_other; "
done

verdict "$reproduced" "$summary"
