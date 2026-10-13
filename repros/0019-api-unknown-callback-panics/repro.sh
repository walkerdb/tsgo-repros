#!/usr/bin/env bash
# `tsgo --api --callbacks <unknown name>` crashes with a Go panic and stack trace instead of printing an error.
source "$(dirname "$0")/../../lib/common.sh"

tsgo_install
make_workdir

reproduced=0 summary=()
# A misspelled name, and a list with a space after the comma.
for callbacks in "readFile,fileExsts" "readFile, fileExists"; do
	rc=0
	timeout 10 "$TSGO" --api --callbacks "$callbacks" </dev/null >out.txt 2>err.txt || rc=$?
	log "--callbacks '$callbacks': exit $rc; stderr:"
	head -6 err.txt >&2
	frames="$(grep -c '^goroutine \|\.go:[0-9]' err.txt || true)"
	if grep -q '^panic: ' err.txt; then
		reproduced=1
		summary+=("'$callbacks': exit $rc, '$(head -1 err.txt)' with $frames stack lines;")
	else
		summary+=("'$callbacks': exit $rc, no panic ($(head -1 err.txt));")
	fi
done
verdict "$reproduced" "${summary[*]}"
