#!/usr/bin/env bash
# JS API: factory update functions return nodes with no text range, so printing loses comments on every rebuilt node.
source "$(dirname "$0")/../../lib/common.sh"
command -v node >/dev/null || die "node is required"
HERE="$(cd "$(dirname "$0")" && pwd)"

tsgo_install
# The API SDK ships in the typescript package next to the native binary (node_modules/typescript).
pkg_dir="$(cd "$(dirname "$TSGO")/../../.." && pwd)/typescript"
[[ -f "$pkg_dir/package.json" ]] || die "no typescript package at $pkg_dir (set TSGO to an installed package's binary)"
make_workdir

out="$(node "$HERE/repro.mjs" "$pkg_dir" "$TSGO" "$WORKDIR")" || die "API client failed: $out"
echo "$out" | sed '$d'
read -r _ reproduced summary <<<"$(echo "$out" | tail -1)"
verdict "$reproduced" "$summary"
