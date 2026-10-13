#!/usr/bin/env bash
# The order of auto-import completions differs between identical requests and between fresh server runs.
source "$(dirname "$0")/../../lib/common.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"

tsgo_install
make_workdir

# A fake package (no network): 20 exported functions, plus a "./next" subpath that re-exports them and declares its own
# useContext.
cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "noEmit": true, "strict": true, "module": "nodenext" }, "include": ["src"] }
JSON
echo '{ "name": "app", "type": "module", "dependencies": { "fakelib": "1.0.0" } }' >package.json
mkdir -p src node_modules/fakelib
cat >node_modules/fakelib/package.json <<'JSON'
{ "name": "fakelib", "version": "1.0.0", "types": "./index.d.ts", "exports": { ".": "./index.d.ts", "./next": "./next.d.ts" } }
JSON
for name in useState useEffect useContext useReducer useCallback useMemo useRef useImperativeHandle useLayoutEffect \
	useDebugValue useDeferredValue useTransition useId useSyncExternalStore useInsertionEffect useOptimistic \
	useActionState useFormStatus useEvent useResource; do
	echo "export declare function $name(): void;"
done >node_modules/fakelib/index.d.ts
cat >node_modules/fakelib/next.d.ts <<'TS'
export * from "./index.js";
export declare function useContext(x: number): void;
TS
printf 'export const x = 1;\nuse\n' >src/a.ts

out="$(TSGO="$TSGO" node "$HERE/repro.mjs" "$WORKDIR")" || die "LSP client failed: $out"
echo "$out" | sed '$d'
read -r _ reproduced summary <<<"$(echo "$out" | tail -1)"
[[ "$reproduced" == 2 ]] && die "$summary"
verdict "$reproduced" "$summary"
