# 0021: package.json dependency completions come back in a random order

| | |
|-|-|
| Status | reproduces; not filed |
| Area | completions (module specifiers), seen through `tsc --api` |
| Reproduces on | 7.0.2, 7.1.0-dev.20261013.1 (both tested) |
| Does not reproduce on | not known |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Requires node. `client.mjs` uses the API client that ships in
the `typescript` package to ask for completions inside `import {} from ""` in a project whose `package.json` lists 12
dependencies (none installed). The script does 8 runs, each with a new server, and counts distinct orders.

This was one of several places where Go map iteration order can reach output. The other one suggested,
primitive-alias spelling suggestions (`getPrimitiveTypeAliasSuggestions`, `internal/checker/checker.go:1804`), is not
observable: `GetSpellingSuggestion` breaks ties between equally close candidates with `compareSymbols`
(`internal/core/core.go:622-629`), so the order the candidates arrive in does not change the result. 14 misspelled
primitive and global names gave the same `Did you mean ...?` output in 10 of 10 CLI runs on both versions. This
one is observable only through the API or language server, not the CLI.

## Bug report draft (for microsoft/TypeScript)

Title: Module specifier completions from package.json dependencies are returned in a random order

### Summary

Completions for an import specifier list the packages from `package.json` `dependencies` (and the other dependency
fields) in a different order on each run. The set is the same; only the order changes. All entries have the same
`sortText`, so nothing else orders them.

### Repro

```
proj/tsconfig.json   { "compilerOptions": { "noEmit": true, "module": "esnext", "moduleResolution": "bundler" }, "include": ["src"] }
proj/package.json    { "name": "p", "dependencies": { "pkg-a": "1.0.0", "pkg-b": "1.0.0", ..., "pkg-l": "1.0.0" } }
proj/src/a.ts        import {} from "";
```

```js
import { API } from "typescript/unstable/sync";

const root = `${process.cwd()}/proj`;
const api = new API({ cwd: process.cwd() });
const project = api.createSnapshot({ openProjects: [`${root}/tsconfig.json`] }).getConfiguredProject(`${root}/tsconfig.json`);
const result = project.languageService.getCompletionsAtPosition(`${root}/src/a.ts`, 'import {} from "'.length);
console.log(result.entries.map((e) => e.name).join(" "));
api.close();
```

(7.0.2: `api.updateSnapshot({ openProjects })`, `getProject(...)`, `project.checker.getCompletionsAtPosition`.)

Expected: the same order on every run, for example the order in `package.json` or sorted by name.

Actual (7.0.2; 8 runs gave 8 orders; all entries have `sortText` `11`):

```
pkg-h pkg-d pkg-j pkg-k pkg-b pkg-c pkg-g pkg-i pkg-l pkg-a pkg-e pkg-f
pkg-h pkg-i pkg-j pkg-k pkg-b pkg-f pkg-l pkg-d pkg-e pkg-c pkg-g pkg-a
pkg-f pkg-k pkg-e pkg-g pkg-i pkg-j pkg-l pkg-a pkg-b pkg-d pkg-h pkg-c
```

7.1.0-dev.20261013.1: 8 of 8 runs gave different orders.

### Impact

Small for editors that sort by `sortText` and then by label. Clients that show the server's order, or tests that
snapshot completion lists, see a different list each time.

### Cause

From the source at commit b85298b6 (line numbers at that commit).

`DependencyFields` stores each dependency field as `map[string]string` (`internal/packagejson/packagejson.go:25-28`),
and `RangeDependencies` ranges over those maps (`packagejson.go:58-87`), so the visit order is Go's random map order.
`enumerateNodeModulesVisibleToScript` (`internal/ls/string_completions.go:1011-1030`) appends the names in that order,
and its caller adds them to the completion list without sorting (`string_completions.go:741`). The JSON object order
is lost when `package.json` is decoded into a map. The same `RangeDependencies` is used by auto-imports
(`internal/ls/autoimport/util.go:235`); whether order matters there was not checked.
