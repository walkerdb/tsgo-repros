#!/usr/bin/env bash
# --api: getCompletionsAtPosition fails with "completion list needs auto imports" instead of returning completions.
source "$(dirname "$0")/../../lib/common.sh"
command -v node >/dev/null || die "node is required"
here="$(cd "$(dirname "$0")" && pwd)"

tsgo_install
pkg_dir="$(cd "$(dirname "$TSGO")/../../.." && pwd)/typescript"
[[ -f "$pkg_dir/dist/api/sync/api.js" ]] || die "no typescript API client at $pkg_dir (set TSGO to an installed package's binary)"
make_workdir

mkdir -p proj/src
echo '{ "compilerOptions": { "noEmit": true, "module": "esnext", "moduleResolution": "bundler" }, "include": ["src"] }' >proj/tsconfig.json
cp proj/tsconfig.json proj/tsconfig.alt.json
printf 'export const fooBarBaz = 1;\n' >proj/src/b.ts
printf 'export {};\nfooBar\n' >proj/src/a.ts

failed=() results=()
for scenario in default alt synthetic; do
	out="$(node "$here/client.mjs" "$pkg_dir" "$TSGO" "$scenario" 2>&1 | tail -1)"
	log "$out"
	results+=("$out;")
	[[ "$out" == *"needs auto imports"* ]] && failed+=("$scenario")
done

reproduced=0
(( ${#failed[@]} > 0 )) && reproduced=1
verdict "$reproduced" "failed with 'needs auto imports': ${failed[*]:-none}; ${results[*]}"
