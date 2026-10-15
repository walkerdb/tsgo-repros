#!/usr/bin/env bash
# workspace/willRenameFiles rewrites unresolved relative imports in files that neither moved nor import the renamed file.
source "$(dirname "$0")/../../lib/common.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"

tsgo_install
make_workdir

# 40 "../" segments climb past the file system root from any work directory.
climb="$(printf '../%.0s' $(seq 40))nope"

cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "noEmit": true, "strict": true, "module": "nodenext" }, "include": ["src"] }
JSON
mkdir -p src node_modules/pkg/internal
echo '{ "name": "pkg", "version": "1.0.0", "types": "./index.d.ts" }' >node_modules/pkg/package.json
echo 'export * from "./internal/types.js";' >node_modules/pkg/index.d.ts
echo "export type { Missing } from \"$climb\"; export type T = number;" >node_modules/pkg/internal/types.d.ts
echo 'export const old = 1;' >src/old.ts
echo 'import { old } from "./old.js"; console.log(old);' >src/index.ts
cat >src/consumer.ts <<TS
import type { T } from "pkg";
import { a } from "./missing.js";
import { b } from "./nested/../missing.js";
import { c } from "$climb";
export const v: T = 1; console.log(a, b, c);
TS

out="$(TSGO="$TSGO" node "$HERE/repro.mjs" "$WORKDIR")" || die "LSP client failed: $out"
echo "$out" | sed '$d'
read -r _ reproduced summary <<<"$(echo "$out" | tail -1)"
[[ "$reproduced" == 2 ]] && die "$summary"
verdict "$reproduced" "$summary"
