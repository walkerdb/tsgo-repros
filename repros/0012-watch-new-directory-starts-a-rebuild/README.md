# 0012: Creating any directory in a watched directory starts a full build

| | |
|-|-|
| Status | reproduces; not filed |
| Area | `tsc --watch`, `tsc -b --watch` |
| Reproduces on | 7.0.2, 7.1.0-dev.20261013.1, 7.1.0-beta, 7.1.0-dev.20261023.1 (both modes) |
| Does not reproduce on | none known |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. For each mode the script measures a quiet period (must start
0 cycles, otherwise the run does not count as reproduced), then runs `mkdir` 3 times beside `src` and counts
"File change detected" lines after each. It takes about 25 s.

## Bug report draft (for microsoft/TypeScript)

Title: `tsc --watch` and `tsc -b --watch` rebuild when an unrelated directory is created

### Summary

Creating a new directory in any directory the watcher watches starts a build, even when no `include` pattern or module
lookup can match anything in it. With `include: ["src"]`, `mkdir notes` in the project root (watched for
`tsconfig.json`) starts a build in both `tsc --watch` and `tsc -b --watch`. With a default setup, the watcher also
watches the ancestors of the project (for `node_modules` and `package.json` lookups), so creating a directory next
to the project, or anywhere in those ancestors, starts a build too.

### Repro

```sh
mkdir -p proj/src && cd proj
echo '{}' > package.json
echo '{ "compilerOptions": { "noEmit": true, "strict": true, "types": [] }, "include": ["src"] }' > tsconfig.json
echo 'export const a: number = 1;' > src/a.ts
tsc --watch --preserveWatchOutput      # or: tsc -b --watch --preserveWatchOutput
# in another terminal, once the first build is done:
mkdir notes
```

`package.json` and `"types": []` only stop the lookup watches at the project, so that the result does not depend on
what happens in the parent directories. Without them, `mkdir ../sibling` also starts a build (checked on
7.1.0-dev.20261013.1 with `TS_WATCH_DEBUG=1`: `update .../sibling`, then "File change detected").

Expected: no build. `notes` is not under `src` and nothing can be imported from it.

Actual (7.1.0-dev.20261013.1, `tsc --watch`; `tsc -b --watch` prints the same):

```
08:40:45 PM - Starting compilation in watch mode...

08:40:45 PM - Found 0 errors. Watching for file changes.

08:40:47 PM - File change detected. Starting incremental compilation...

08:40:47 PM - Found 0 errors. Watching for file changes.
```

`tsc -b --watch` also rewrites `tsconfig.tsbuildinfo` in that cycle. Script result on both versions:

```
tsc --watch: 1 1 1 cycles after 3 mkdirs (quiet period: 0); tsc -b --watch: 1 1 1 cycles after 3 mkdirs (quiet period: 0)
```

### Impact

Tools and people create directories all the time (editors, test runners, `git` operations, other build tools writing
caches, temporary directories in a parent folder). Each one costs a build. In `tsc --watch` it is a full program build
with a re-read of the wildcard file names; in `tsc -b --watch` every project in the build is rebuilt.

### Cause

Line numbers are at commit b85298b6 (2026-09-29); the npm builds may be from other commits.

`tsc --watch`: `Watcher.isRelevantChange` (`internal/execute/watcher.go:391`) returns true for any event path that is
an existing directory under any watched directory (`IsPathUnderWatch`, `internal/execute/watchmanager/watchmanager.go:355`).
`DoCycle` then sets `watchSetDirty` for it (watcher.go:317). `doBuild` reloads the file names (watcher.go:430); they are
unchanged, but no program file changed either, so `tryUpdateProgram` returns false (`changedCount == 0`,
watcher.go:566) and a new program is built.

`tsc -b --watch`: `Orchestrator.checkTasksForEventChanges` (`internal/execute/build/orchestrator.go:655-668`), when
nothing else changed, resets the status of every task if any event path is an existing directory under a watch, and
`DoCycle` (orchestrator.go:818) builds them all.

Neither check asks whether the directory matches a wildcard directory of the config or a module lookup location.
