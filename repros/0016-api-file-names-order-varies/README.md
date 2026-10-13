# 0016: --api returns a config's fileNames in a random order after a snapshot update that adds a file

| | |
|-|-|
| Status | reproduces on the nightly; not filed |
| Area | `tsc --api` (snapshots, project system) |
| Reproduces on | 7.1.0-dev.20261013.1 |
| Does not reproduce on | 7.0.2 (both tested; 7.0.2 has no request file system, and its `fileChanges` path keeps the order) |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Requires node. `client.mjs` uses the API client that ships in
the `typescript` package (`typescript/unstable/sync`, loaded from the installed package). Each run starts a new
server, opens `proj/tsconfig.json`, adds `src/added.ts`, and prints the project's `parsedCommandLine.fileNames`. The
script does 8 runs for each of two ways of adding the file:

- `layer`: `snapshot.update({ fileSystem: { kind: "layer", files: { "<proj>/src/added.ts": ... } } })`
- `disk`: write the file, then `snapshot.update({ fileNotifications: { created: ["<proj>/src/added.ts"] } })`

The earlier note said this needs a layered or virtual file system. It does not: a file-created notification for a
real file on disk is enough. The slug is unchanged.

## Bug report draft (for microsoft/TypeScript)

Title: API: config `fileNames` come back in a random order after a snapshot update that adds or removes a file

### Summary

After a snapshot update that creates or deletes a file matched by a tsconfig `include` glob, the project's
`parsedCommandLine.fileNames` lists the files in a different order on every run. The set of files is right; only the
order changes. Before the update, and when the update only changes a file's content, the list is sorted.

### Repro

```
proj/tsconfig.json     { "compilerOptions": { "noEmit": true }, "include": ["src"] }
proj/src/a0.ts ... a7.ts       export const aN = N;
proj/src/sub/b0.ts ... b7.ts   export const bN = N;
```

```js
import fs from "node:fs";
import { API } from "typescript/unstable/sync";

const root = `${process.cwd()}/proj`;
const config = `${root}/tsconfig.json`;
const added = `${root}/src/added.ts`;
const api = new API({ cwd: process.cwd() });
const first = api.createSnapshot({ openProjects: [config] });
fs.writeFileSync(added, "export const added = 1;\n");
const second = first.update({ fileNotifications: { created: [added] }, ensurePrograms: true });
console.log(second.getConfiguredProject(config).parsedCommandLine.fileNames.join("\n"));
api.close();
```

Supplying the file in a request file system layer instead (`first.update({ fileSystem: { kind: "layer", files:
{ [added]: "..." } }, ensurePrograms: true })`) gives the same result.

Expected: the same order on every run, sorted as in the first snapshot (`src/a0.ts ... src/a7.ts src/added.ts
src/sub/b0.ts ... src/sub/b7.ts`).

Actual (7.1.0-dev.20261013.1, 8 of 8 runs gave different orders, for both the layer and the on-disk change):

```
src/a3.ts src/a1.ts src/a7.ts src/a0.ts src/a2.ts src/a6.ts src/a5.ts src/a4.ts src/added.ts src/sub/b2.ts src/sub/b5.ts src/sub/b1.ts src/sub/b3.ts src/sub/b6.ts src/sub/b4.ts src/sub/b7.ts src/sub/b0.ts
src/a0.ts src/a4.ts src/a1.ts src/a3.ts src/a5.ts src/a2.ts src/a7.ts src/a6.ts src/added.ts src/sub/b3.ts src/sub/b2.ts src/sub/b4.ts src/sub/b6.ts src/sub/b5.ts src/sub/b1.ts src/sub/b0.ts src/sub/b7.ts
src/a4.ts src/a0.ts src/a1.ts src/a6.ts src/a2.ts src/a7.ts src/a5.ts src/a3.ts src/added.ts src/sub/b4.ts src/sub/b0.ts src/sub/b1.ts src/sub/b2.ts src/sub/b5.ts src/sub/b6.ts src/sub/b7.ts src/sub/b3.ts
```

7.0.2, with the equivalent `api.updateSnapshot({ fileChanges: { created: [added] } })`, returns the sorted order in
every run.

### Impact

API clients that compare file lists between snapshots, cache by file order, or print the list see spurious changes.
The root file order is also the program's file order, so it can change the order of diagnostics and other per-file
results (inferred from the code path, not checked). The language server uses the same project code, so its projects
may be affected after file-created and file-deleted events too (also not checked).

### Cause

From the source at commit b85298b6 (line numbers at that commit); the link to the output is inferred from reading the
code.

A created or deleted file makes the config's file names reload (`PendingReloadFileNames`,
`internal/project/configfileregistrybuilder.go:151-153`), which re-expands the include globs through the snapshot's
file system. Glob matching keeps the order the file system returns (`internal/vfs/vfsmatch/vfsmatch.go:607-628`) and
does not sort. The snapshot file system merges the directory listing with the files it has cached for that
directory in `mergeCachedDirectoryEntries` (`internal/project/snapshotfs.go:144-174`), which ranges over a Go map
(`for childPath, childName := range cachedEntries`, `:152`) and appends in that order without sorting. The files that
were read before the update are the cached ones, so they come out in map order; the new file, not cached yet, is
appended after them from the sorted lower listing. Sorting `entries.Files` and `entries.Directories` at the end of
`mergeCachedDirectoryEntries` would likely fix it. `overlayFS.GetAccessibleEntries` (`internal/project/overlayfs.go:306`)
has the same pattern for open-file overlays.
