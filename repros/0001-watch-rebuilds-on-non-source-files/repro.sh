#!/usr/bin/env bash
# `tsc --watch` starts a rebuild when a file that cannot be part of the program changes under an included directory.
source "$(dirname "$0")/../../lib/common.sh"

tsgo_install
make_workdir

# src/sub exists before the watch starts, so creating it is not one of the changes counted below.
mkdir -p src/sub other
cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "noEmit": true, "strict": true }, "include": ["src"] }
JSON
echo 'export const a: number = 1;' >src/a.ts

watch_start -p .
log "first build done; changing files the program cannot include"

# Control: a non-source file outside the include. Expected and observed: no rebuild.
for i in 1 2 3; do echo "note $i" >>other/notes.txt; sleep 1; done
watch_settle 2
control="$(watch_cycles)"

# A non-source file under the included directory.
for i in 1 2 3; do echo "note $i" >>src/notes.txt; sleep 1; done
watch_settle 2
notes=$(( $(watch_cycles) - control ))

# What vim does on every :w: create and delete a probe file named 4913 in the file's directory.
for i in 1 2 3; do touch src/sub/4913; rm src/sub/4913; sleep 1; done
watch_settle 2
probe=$(( $(watch_cycles) - control - notes ))

echo "rebuilds for 3 writes to other/notes.txt (outside include): $control"
echo "rebuilds for 3 writes to src/notes.txt:                     $notes"
echo "rebuilds for 3 create+delete of src/sub/4913:              $probe"

reproduced=0
(( notes > 0 || probe > 0 )) && reproduced=1
verdict "$reproduced" "$((notes + probe)) rebuilds for changes to files that are not TypeScript sources"
