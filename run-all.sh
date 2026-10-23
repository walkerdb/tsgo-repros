#!/usr/bin/env bash
# Runs every repro (or those whose directory names contain one of the arguments) and prints a summary.
# TSGO_VERSION and TSGO apply to all of them; see lib/common.sh.
set -uo pipefail
cd "$(dirname "$0")"

status=0
for dir in repros/*/; do
	name="$(basename "$dir")"
	if (( $# > 0 )); then
		match=0
		for arg in "$@"; do [[ "$name" == *"$arg"* ]] && match=1; done
		(( match )) || continue
	fi
	out="$("$dir/repro.sh" 2>&1)"
	code=$?
	case "$code" in
		0) result="fixed" ;;
		1) result="reproduces" ;;
		77) result="skipped: ${out##*SKIPPED: }" ;;
		*) result="error ($code)"; status=2 ;;
	esac
	printf '%-50s %s\n' "$name" "$result"
	[[ "$result" == error* ]] && printf '%s\n' "$out" | tail -20 | sed 's/^/    /'
done
exit "$status"
