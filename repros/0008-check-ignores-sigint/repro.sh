#!/usr/bin/env bash
# `tsc -p` keeps type checking after SIGINT or SIGTERM and exits only when the whole check is done.
source "$(dirname "$0")/../../lib/common.sh"

tsgo_install
make_workdir

# 64 copies of one function whose control flow analysis is quadratic: several seconds of checking, under 300 MB.
mkdir src
{
	printf 'declare function c(): boolean;\ndeclare function use(v: unknown): void;\n'
	printf 'export function g(x: string | number | boolean | undefined) {\n'
	for j in $(seq 1 1600); do printf '\tif (c()) { x = %s; }\n\tuse(x);\n' "$j"; done
	printf '}\n'
} >src/f1.ts
for i in $(seq 2 64); do cp src/f1.ts "src/f$i.ts"; done
cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "strict": true, "noEmit": true, "types": [] }, "include": ["src"] }
JSON

now_ms() { echo $(( $(date +%s%N) / 1000000 )); }

# Runs tsgo with the given arguments, sends $1 after 2 s (or nothing for "none"), and sets ELAPSED_MS (time from
# start to exit), SIGNAL_TO_EXIT_MS and RC.
run() {
	local sig="$1"; shift
	local start pid sent
	start="$(now_ms)"
	"$TSGO" -p . --pretty false "$@" >"run.log" 2>&1 &
	pid=$!
	sent="$start"
	if [[ "$sig" != none ]]; then
		sleep 2
		kill -0 "$pid" 2>/dev/null || die "tsgo finished in under 2 s; the project is too small to show the bug"
		sent="$(now_ms)"
		kill "-$sig" "$pid"
	fi
	RC=0
	wait "$pid" || RC=$?
	ELAPSED_MS=$(( $(now_ms) - start ))
	SIGNAL_TO_EXIT_MS=$(( $(now_ms) - sent ))
}

run none
full_ms="$ELAPSED_MS"
log "no signal: check finished after $full_ms ms (exit $RC)"
grep -q 'error' run.log && { cat run.log >&2; die "unexpected diagnostics"; }

worst=0 summary=()
for mode in "INT" "TERM" "INT --incremental" "INT --watch"; do
	read -r sig args <<<"$mode"
	rm -f tsconfig.tsbuildinfo
	# shellcheck disable=SC2086
	run "$sig" $args
	log "SIG$sig${args:+ with $args}: sent at 2 s, exited $SIGNAL_TO_EXIT_MS ms later (exit $RC)"
	summary+=("SIG$sig${args:+ $args} ${SIGNAL_TO_EXIT_MS} ms")
	(( SIGNAL_TO_EXIT_MS > worst )) && worst="$SIGNAL_TO_EXIT_MS"
	[[ "$mode" == "INT" ]] && plain_ms="$SIGNAL_TO_EXIT_MS"
done

# A process that honours the signal exits within a fraction of a second. Call it reproduced when the plain check
# (no --incremental, no --watch) takes over 1 s and over half the remaining check time to exit after SIGINT. The
# threshold is relative because the check gets faster between versions (7.0.2 about 8 s, 7.1 about 6 s).
reproduced=0
if (( plain_ms > 1000 && plain_ms * 2 > full_ms - 2000 )); then reproduced=1; fi
verdict "$reproduced" "full check $full_ms ms; time from signal (sent at 2 s) to exit: ${summary[*]}"
