#!/usr/bin/env bash
# A `git checkout` that rewrites many files makes `tsc --watch` build twice: the first build starts on the first file
# event, while git is still writing, and can report errors for files that have not been written yet.
source "$(dirname "$0")/../../lib/common.sh"

FILES="${FILES:-3000}"
CHECKOUTS="${CHECKOUTS:-4}"
command -v git >/dev/null || die "git is required"

tsgo_install
make_workdir

# A chain of modules, each importing the previous one, so a build that sees a half-written tree reports TS2307.
log "creating a git repo with $FILES modules and a branch that changes every one"
mkdir src
cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "noEmit": true, "strict": true }, "include": ["src"] }
JSON
echo 'export const v0: number = 0;' >src/m0.ts
for ((i = 1; i < FILES; i++)); do
	printf 'import { v%d } from "./m%d";\nexport const v%d: number = v%d + 1;\n' $((i - 1)) $((i - 1)) $i $((i - 1)) >"src/m$i.ts"
done
git init -q -b main . && git add -A && git -c user.name=repro -c user.email=repro@example.com commit -qm main
git checkout -qb other
for ((i = 0; i < FILES; i++)); do echo "export const b$i = \"b\";" >>"src/m$i.ts"; done
git -c user.name=repro -c user.email=repro@example.com commit -qam other
git checkout -q main

watch_start -p .
log "first build done; switching branches $CHECKOUTS times"

branch=other
for ((n = 0; n < CHECKOUTS; n++)); do
	before="$(watch_cycles)"
	git checkout -q "$branch"
	watch_settle "${SETTLE:-3}"
	echo "git checkout $branch: $(( $(watch_cycles) - before )) builds"
	[[ "$branch" == other ]] && branch=main || branch=other
done

cycles="$(watch_cycles)"
false_errors="$(grep -c 'error TS' "$WATCH_LOG" || true)"
echo "total: $cycles builds for $CHECKOUTS checkouts; $false_errors errors reported (the project has none)"
grep 'error TS' "$WATCH_LOG" | head -5 || true

reproduced=0
(( cycles > CHECKOUTS || false_errors > 0 )) && reproduced=1
verdict "$reproduced" "$cycles builds for $CHECKOUTS checkouts, $false_errors transient errors"
