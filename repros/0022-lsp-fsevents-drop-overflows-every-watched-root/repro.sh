#!/usr/bin/env bash
# macOS language server: a burst of writes under one watched directory reports an overflow on every watched directory.
source "$(dirname "$0")/../../lib/common.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"

# The bug is in the FSEvents backend; other platforms have no builtin watcher for the language server.
[[ "$(uname -s)" == Darwin ]] || verdict 0 "skipped: needs macOS (FSEvents)"

tsgo_install
make_workdir

out="$(TSGO="$TSGO" node "$HERE/repro.mjs" "$(pwd -P)")" || die "LSP client failed: $out"
echo "$out" | sed '$d'
read -r _ reproduced summary <<<"$(echo "$out" | tail -1)"
[[ "$reproduced" == 2 ]] && die "$summary"
verdict "$reproduced" "$summary"
