# 0007: auto-import completions come back in a different order on every request

| | |
|-|-|
| Status | reproduces (item order only); not filed |
| Area | language server, completions (auto-imports) |
| Reproduces on | 7.0.2, 7.1.0-dev.20261013.1 |
| Does not reproduce on | none known |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Needs Node 22 (the LSP client is `lib/lsp-client.mjs`). Starts 6
fresh servers and sends 2 identical completion requests to each. Takes about 10 s.

What was and was not reproduced: an earlier observation in a large project saw both a different item order between
runs and, in 1 of 4 runs, `useContext` offered from `react/next` instead of `react`. This repro shows the order
difference every time. It does not show the module difference: with a fake package whose `./next` subpath declares its
own `useContext`, both items are returned in all 12 requests on both versions, and `fakelib` always comes before
`fakelib/next`. The script still prints which module the first `useContext` item comes from, as a check.

## Bug report draft (for microsoft/TypeScript)

Title: Auto-import completion items are returned in a random order

### Summary

The order of auto-import items in a `textDocument/completion` response changes from one request to the next, with no
edits in between, and between server runs. The set of items, their `sortText`, labels and modules is the same each
time; only the order in the list changes.

### Repro

No network needed; the package is a fake one under `node_modules`.

```sh
mkdir -p proj/src proj/node_modules/fakelib && cd proj
echo '{ "compilerOptions": { "noEmit": true, "strict": true, "module": "nodenext" }, "include": ["src"] }' > tsconfig.json
echo '{ "name": "app", "type": "module", "dependencies": { "fakelib": "1.0.0" } }' > package.json
echo '{ "name": "fakelib", "version": "1.0.0", "types": "./index.d.ts", "exports": { ".": "./index.d.ts", "./next": "./next.d.ts" } }' > node_modules/fakelib/package.json
for name in useState useEffect useContext useReducer useCallback useMemo useRef useImperativeHandle useLayoutEffect \
  useDebugValue useDeferredValue useTransition useId useSyncExternalStore useInsertionEffect useOptimistic \
  useActionState useFormStatus useEvent useResource; do
  echo "export declare function $name(): void;"
done > node_modules/fakelib/index.d.ts
printf 'export * from "./index.js";\nexport declare function useContext(x: number): void;\n' > node_modules/fakelib/next.d.ts
printf 'export const x = 1;\nuse\n' > src/a.ts
```

Start `tsc --lsp --stdio`, open `src/a.ts`, and send `textDocument/completion` at line 1, character 3 (after `use`)
twice. Repeat with a fresh server.

Expected: the same response each time.

Actual (7.0.2 and 7.1.0-dev.20261013.1), first 6 of the 21 items:

```
run 1 request 1: 21 items: useImperativeHandle@fakelib useState@fakelib useContext@fakelib useInsertionEffect@fakelib useMemo@fakelib useActionState@fakelib ...
run 1 request 2: 21 items: useDebugValue@fakelib useDeferredValue@fakelib useState@fakelib useEvent@fakelib useReducer@fakelib useRef@fakelib ...
run 2 request 1: 21 items: useDeferredValue@fakelib useId@fakelib useTransition@fakelib useDebugValue@fakelib useEffect@fakelib useLayoutEffect@fakelib ...
...
sets of (sortText, label, module) identical across all requests: true; item counts: 21
REPRODUCED: 12 distinct item orders in 12 identical completion requests over 6 fresh servers; 6 of 6 servers returned a different order for the second identical request
```

### Impact

Low for editors that sort by `sortText` and then by label, since the items that move have different labels. It does
affect clients or tools that keep the server's order for items they consider equal, snapshot tests and baselines of
LSP output, and any comparison of two servers' responses (a diff shows changes on every run).

### Cause

Line numbers are at commit b85298b6 (2026-09-29), `internal/ls/autoimport`.

- `View.GetCompletions` groups exports in a map (`view.go:188`) and builds the fix list by ranging over it
  (`view.go:242`), so the input order is random (Go randomizes map iteration).
- It then sorts with `CompareFixesForSorting` (`view.go:259`). That comparator ignores the export name: for two
  exports of the same module with the same import kind it returns 0 (`fix.go:1049-1067`, which notes "further
  tie-breakers? In practice this is only called on fixes with the same name"). The comment at `view.go:255` says the
  client will sort by SortText and Label, so name is left out on purpose.
- With equal keys and a random input order, the output order is random too. Adding the export name (and the module
  specifier) as final tie-breakers, or iterating the groups in a sorted order, would make it deterministic.
