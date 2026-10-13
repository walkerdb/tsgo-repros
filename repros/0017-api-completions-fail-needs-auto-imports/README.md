# 0017: --api completions fail with "completion list needs auto imports"

| | |
|-|-|
| Status | reproduces; not filed |
| Area | `tsc --api`, completions, auto-imports |
| Reproduces on | 7.0.2 (every scenario tried), 7.1.0-dev.20261013.1 (when the project is not the file's default project) |
| Does not reproduce on | 7.1.0-dev.20261013.1 in the file's default project |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Requires node. `client.mjs` uses the API client that ships in
the `typescript` package and asks for completions at the end of `fooBar` in `src/a.ts`, where `fooBarBaz` from
`src/b.ts` is an auto-import candidate, in three scenarios:

- `default`: `proj/tsconfig.json` open; completions in that project, the file's default project.
- `alt`: `proj/tsconfig.json` and `proj/tsconfig.alt.json` (same contents) open; completions in the alt project.
- `synthetic`: a program created with `createPrograms` from `a.ts` and `b.ts` (7.1 only).

## Bug report draft (for microsoft/TypeScript)

Title: API `getCompletionsAtPosition` fails with "completion list needs auto imports" outside the file's default project

### Summary

`languageService.getCompletionsAtPosition` throws `completion list needs auto imports` when the requested project is
not the file's default project, for example a second tsconfig that includes the same file, or a program created with
`createPrograms`. The server retries once with auto-imports prepared, but it prepares them for the file's default
project, so the retry fails the same way. In 7.0.2 the request fails even in the default project.

### Repro

```
proj/tsconfig.json       { "compilerOptions": { "noEmit": true, "module": "esnext", "moduleResolution": "bundler" }, "include": ["src"] }
proj/tsconfig.alt.json   (same as tsconfig.json)
proj/src/b.ts            export const fooBarBaz = 1;
proj/src/a.ts            export {};
                         fooBar
```

```js
import { API } from "typescript/unstable/sync";

const root = `${process.cwd()}/proj`;
const api = new API({ cwd: process.cwd() });
const position = "export {};\nfooBar".length;

const snapshot = api.createSnapshot({ openProjects: [`${root}/tsconfig.json`, `${root}/tsconfig.alt.json`] });
const project = snapshot.getConfiguredProject(`${root}/tsconfig.alt.json`);
project.languageService.getCompletionsAtPosition(`${root}/src/a.ts`, position);
// also fails: a synthetic program
// api.createSnapshot({ createPrograms: [{ rootFiles: [a, b], compilerOptions: { module: 99, moduleResolution: 100 } }] })
```

Expected: a completion list that includes the auto-import `fooBarBaz`, as for `tsconfig.json`.

Actual (7.1.0-dev.20261013.1):

```
default ok 1076 entries, fooBarBaz: yes
alt error completion list needs auto imports
synthetic error completion list needs auto imports
```

7.0.2 (`api.updateSnapshot({ openProjects })` and `project.checker.getCompletionsAtPosition`; no `createPrograms`):

```
default error completion list needs auto imports
alt error completion list needs auto imports
```

### Impact

Tools that use the API for completions in anything other than the default project (multiple tsconfigs over one
folder, test or build configs, synthetic programs) get an internal error instead of a completion list, with no way to
prepare auto-imports for that project from the client.

### Cause

From the source at commit b85298b6 (line numbers at that commit); inferred from reading, not traced.

`handleGetCompletionsAtPosition` (`internal/api/session.go:5304-5350`) runs the completion; on `ErrNeedsAutoImports` it
calls `CloneSnapshotWithAutoImports(ctx, sd.snapshot, file, nil)` and runs it again in `params.Project`
(`session.go:5332-5348`). The language service raises `ErrNeedsAutoImports` when
`registry.IsPreparedForImportingFile(file, l.projectID, ...)` is false (`internal/ls/languageservice.go:94-103`).
The preparation only adds the file's default project to the auto-import registry: `GetDefaultProject(change.RequestedFile)`
(`internal/ls/autoimport/registry.go:584-587` and `:809`). When `params.Project` is a different project, its bucket
is still missing (`registry.go:354-362` returns false when `r.projects[projectID]` is absent), so the second run
returns the same error, and it is passed to the client. The 7.0.2 build is older than this commit; its failure in the
default project was observed but its code was not read.
