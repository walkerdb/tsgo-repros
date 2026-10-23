# 0011: `tsc --watch` starts a second build after every edit because of its own outputs

| | |
|-|-|
| Status | reproduces; not filed |
| Area | `tsc --watch` |
| Reproduces on | 7.0.2, 7.1.0-dev.20261013.1, 7.1.0-beta, 7.1.0-dev.20261023.1 |
| Does not reproduce on | `tsc -b --watch` (1 cycle per edit on both versions) |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. The script edits `a.ts` 3 times in each of two projects, in
`tsc --watch` and in `tsc -b --watch`, and counts "File change detected" lines per edit. It takes about 40 s.

## Bug report draft (for microsoft/TypeScript)

Title: `tsc --watch` rebuilds twice per edit when outputs or .tsbuildinfo are written inside the include directory

### Summary

When `tsc --watch` writes files inside a directory its `include` covers, the writes come back as file events and start
a second build. This happens with the default `include` (`**/*`) and an `outDir` inside the project (even though
`outDir` is excluded by default), and with `"noEmit": true, "incremental": true`, which writes `tsconfig.tsbuildinfo`
next to `tsconfig.json`. Every save then costs two builds. The second one finds nothing to emit, so it does not loop.
`tsc -b --watch` runs 1 build per edit for the same projects.

### Repro

```sh
mkdir proj && cd proj
echo '{}' > package.json
echo '{ "compilerOptions": { "noEmit": true, "incremental": true, "strict": true, "types": [] } }' > tsconfig.json
echo 'export const a: number = 0;' > a.ts
tsc --watch --preserveWatchOutput
# in another terminal, once the first build is done:
echo 'export const a: number = 1;' > a.ts
```

The same happens with `{ "compilerOptions": { "outDir": "out", "declaration": true } }` and `a.ts` plus
`b.ts` (`import { a } from "./a"; export const b = a + 1;`): the writes to `out/a.js` and `out/a.d.ts` start the second
build. `package.json` and `"types": []` are not needed for the bug; they only keep the watch to the project directory.

Expected: one "File change detected" per edit.

Actual (7.1.0-dev.20261013.1):

```
08:40:04 PM - Starting compilation in watch mode...

08:40:04 PM - Found 0 errors. Watching for file changes.

08:40:07 PM - File change detected. Starting incremental compilation...

08:40:07 PM - Found 0 errors. Watching for file changes.

08:40:07 PM - File change detected. Starting incremental compilation...

08:40:07 PM - Found 0 errors. Watching for file changes.
```

With `TS_WATCH_DEBUG=1`, the event that starts the second build is the build's own output:

```
[watch] 1 event(s): update .../proj/a.ts
[watch] evicting cached source file: .../proj/a.ts
08:17:57 PM - File change detected. Starting incremental compilation...
08:17:57 PM - Found 0 errors. Watching for file changes.
[watch] 2 event(s): update .../proj/out/a.js, update .../proj/out/a.d.ts
08:17:57 PM - File change detected. Starting incremental compilation...
08:17:57 PM - Found 0 errors. Watching for file changes.
```

Script result on both versions, 3 edits per case:

```
outdir tsc --watch: 2 2 2 cycles per edit; outdir tsc -b --watch: 1 1 1 cycles per edit;
tsbuildinfo tsc --watch: 2 2 2 cycles per edit; tsbuildinfo tsc -b --watch: 1 1 1 cycles per edit
```

The outputs do not become program inputs (no TS5055, "Found 0 errors" each time).

### Impact

Each save runs two builds in common setups (`incremental` type checking with `noEmit`, or an `outDir` under the
project). From the source (below), the second one is a full program build, not the single-file fast path, so the extra
cost grows with project size.

### Cause

Line numbers are at commit b85298b6 (2026-09-29); the npm builds may be from other commits.

`Watcher.DoCycle` (`internal/execute/watcher.go:291`) treats an event as relevant when
`config.PossiblyMatchesFileName` or `PossiblyMatchesDirectoryName` says so (`isRelevantChange`, watcher.go:391).
`PossiblyMatchesFileName` (`internal/tsoptions/parsedcommandline.go:403`) matches against globs built from the
wildcard directories only (`WildcardDirectoryGlobs`, parsedcommandline.go:276); it does not apply `exclude`, the
default `outDir` exclusion, or the list of the program's outputs. `PossiblyMatchesDirectoryName`
(parsedcommandline.go:433) is called with the event's file path and returns true for any path under a recursive
wildcard directory, which is how the `.tsbuildinfo` and `.js` writes count.

For `out/a.d.ts`, the file matches the glob and is not in `seenFiles`, so DoCycle sets `watchSetDirty` and
`forceFullRebuild` (watcher.go:326-333). For the other outputs no flag is set, but no program file changed either, so
`tryUpdateProgram` (watcher.go:548) returns false at `changedCount == 0` (watcher.go:566) and `doBuild` builds a new program. Either way
it is a full build (inference from the source; the CLI prints no difference).

TypeScript 5.x drops these events in its wildcard directory watcher: `isIgnoredFileFromWildCardWatching`
(`src/compiler/watchUtilities.ts`) ignores files under `outDir`/`declarationDir`, files that are outputs of program
files, and files without a supported source extension. I did not run 5.x for this report.
