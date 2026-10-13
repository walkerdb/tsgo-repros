#!/usr/bin/env bash
# One line: what goes wrong.
source "$(dirname "$0")/../../lib/common.sh"

tsgo_install
make_workdir

# Set up the smallest project that shows the bug.
cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "noEmit": true, "strict": true }, "include": ["src"] }
JSON
mkdir src
echo 'export const a: number = 1;' >src/a.ts

# Run tsgo ("$TSGO" ...) or a watch session (watch_start, watch_cycles, watch_settle), then decide.
reproduced=0
verdict "$reproduced" "what was observed, with numbers"
