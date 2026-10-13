#!/usr/bin/env bash
# Module specifier completions from package.json dependencies come back in a different order on every run.
source "$(dirname "$0")/../../lib/common.sh"
command -v node >/dev/null || die "node is required"
here="$(cd "$(dirname "$0")" && pwd)"

tsgo_install
pkg_dir="$(cd "$(dirname "$TSGO")/../../.." && pwd)/typescript"
[[ -f "$pkg_dir/dist/api/sync/api.js" ]] || die "no typescript API client at $pkg_dir (set TSGO to an installed package's binary)"
make_workdir

mkdir -p proj/src
echo '{ "compilerOptions": { "noEmit": true, "module": "esnext", "moduleResolution": "bundler" }, "include": ["src"] }' >proj/tsconfig.json
cat >proj/package.json <<'JSON'
{
	"name": "p",
	"dependencies": {
		"pkg-a": "1.0.0", "pkg-b": "1.0.0", "pkg-c": "1.0.0", "pkg-d": "1.0.0", "pkg-e": "1.0.0", "pkg-f": "1.0.0",
		"pkg-g": "1.0.0", "pkg-h": "1.0.0", "pkg-i": "1.0.0", "pkg-j": "1.0.0", "pkg-k": "1.0.0", "pkg-l": "1.0.0"
	}
}
JSON
printf 'import {} from "";\n' >proj/src/a.ts

runs=8
: >orders.txt
for r in $(seq "$runs"); do
	node "$here/client.mjs" "$pkg_dir" "$TSGO" >out.txt 2>err.txt || { cat err.txt >&2; die "client failed"; }
	head -1 out.txt >>orders.txt
done
log "$(tail -1 out.txt)"
head -3 orders.txt | sed 's/^/  /' >&2
distinct="$(sort -u orders.txt | wc -l)"
sets="$(while read -r line; do tr ' ' '\n' <<<"$line" | sort | tr '\n' ' '; echo; done <orders.txt | sort -u | wc -l)"
entries="$(head -1 orders.txt | wc -w)"
(( entries > 0 )) || die "no completions returned"

reproduced=0
(( distinct > 1 )) && reproduced=1
verdict "$reproduced" "$distinct distinct orders of the $entries completions in $runs runs ($sets distinct set(s))"
