#!/usr/bin/env bash
# --api: after a snapshot update that adds a file, a config's include-glob fileNames come back in a different order on
# every run.
source "$(dirname "$0")/../../lib/common.sh"
command -v node >/dev/null || die "node is required"
here="$(cd "$(dirname "$0")" && pwd)"

tsgo_install
# The API client ships in the typescript package next to the native binary (node_modules/typescript).
pkg_dir="$(cd "$(dirname "$TSGO")/../../.." && pwd)/typescript"
[[ -f "$pkg_dir/dist/api/sync/api.js" ]] || die "no typescript API client at $pkg_dir (set TSGO to an installed package's binary)"
make_workdir

mkdir -p proj/src/sub
echo '{ "compilerOptions": { "noEmit": true }, "include": ["src"] }' >proj/tsconfig.json
for i in 0 1 2 3 4 5 6 7; do
	echo "export const a$i = $i;" >"proj/src/a$i.ts"
	echo "export const b$i = $i;" >"proj/src/sub/b$i.ts"
done

runs=8
reproduced=0 summary=()
for mode in layer disk; do
	: >"orders-$mode.txt"
	for r in $(seq "$runs"); do
		node "$here/client.mjs" "$pkg_dir" "$TSGO" "$mode" >>"orders-$mode.txt" 2>"client-$mode.log" || { cat "client-$mode.log" >&2; die "client failed"; }
	done
	if grep -q '^unsupported' "orders-$mode.txt"; then
		log "$mode: not supported by this version"
		summary+=("$mode: unsupported")
		continue
	fi
	distinct="$(sort -u "orders-$mode.txt" | wc -l)"
	sorted_distinct="$(while read -r line; do tr ' ' '\n' <<<"$line" | sort | tr '\n' ' '; echo; done <"orders-$mode.txt" | sort -u | wc -l)"
	log "$mode: $distinct distinct fileNames orders in $runs runs ($sorted_distinct distinct file sets)"
	head -3 "orders-$mode.txt" | sed 's/^/  /' >&2
	summary+=("$mode: $distinct orders in $runs runs, $sorted_distinct file set(s)")
	(( distinct > 1 )) && reproduced=1
done
verdict "$reproduced" "${summary[*]}"
