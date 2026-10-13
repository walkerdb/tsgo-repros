# 0002: watch misses a save made during the first build

| | |
|-|-|
| Status | reproduces; not filed |
| Area | `tsc --watch`, `tsc -b --watch` (Linux, inotify) |
| Reproduces on | 7.0.2, 7.1.0-dev.20261013.1 |
| Does not reproduce on | none known |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Needs `node` (to generate the slow file) and `bc`. Takes about
30 s.

The script generates `src/big.ts`, which takes about 3.5 s to check and well under 100 ms to parse, and saves
`src/a.ts` 1 s after the watch starts. It classifies each attempt: the first build shows the new error (saved too
early), a cycle started (saved after watching began), or neither (the bug). It retries with another delay, up to 4
times, if the save missed the window.

## Bug report draft (for microsoft/TypeScript)

Title: `--watch` misses a file saved during the first build and keeps reporting its old diagnostics

### Summary

`tsc --watch` and `tsc -b --watch` create their file watches only after the first build has finished. A file saved
while the first build is running, after the build read it, produces no event that the watch sees, and nothing compares
the files with what was read. The watch then reports the old file's diagnostics, says it is watching, and starts no
further cycle. On 7.0.2 the save is picked up when some other file changes; on 7.1.0-dev.20261013.1, `tsc --watch`
keeps the stale result even then, until the file itself is saved again.

In large projects the first build takes tens of seconds, and saving during it is normal (start the watch, keep
editing).

### Repro

On Linux:

```sh
mkdir -p proj/src && cd proj
echo '{ "type": "module" }' > package.json
echo '{ "compilerOptions": { "noEmit": true, "strict": true, "types": [] }, "include": ["src"] }' > tsconfig.json
echo 'export const a: number = 1;' > src/a.ts
# A file that takes about 3.5 s to check:
node -e '
  const n = 1000, m = 4000;
  let s = "type U = " + Array.from({ length: n }, (_, i) => `{ p${i}: number; q${i}: string }`).join(" | ") + ";\n";
  for (let i = 0; i < m; i++) s += `export const x${i}: U = { p${(i * 7) % n}: ${i}, q${(i * 7) % n}: "s" };\n`;
  require("fs").writeFileSync("src/big.ts", s);'

tsc --watch --preserveWatchOutput &      # or: tsc -b --watch --preserveWatchOutput &
sleep 1
echo 'export const a: number = "saved during the first build";' > src/a.ts
sleep 8
tsc -p . --noEmit                        # fresh build, for comparison
```

Expected: the watch reports
`src/a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.`, either in the first build or in a
cycle right after it.

Actual (7.0.2; `tsc -b --watch` and 7.1.0-dev.20261013.1 are the same):

```
08:24:58 PM - Starting compilation in watch mode...

08:25:01 PM - Found 0 errors. Watching for file changes.
```

and no further cycle, while the fresh build reports the TS2322 error. On 7.0.2 (both modes) and on 7.1.0-dev.20261013.1
with `tsc -b --watch`, saving another file (`src/c.ts`) later starts a cycle that finally reports it:

```
08:25:08 PM - File change detected. Starting incremental compilation...

src/a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.
08:25:08 PM - Found 1 error. Watching for file changes.
```

On 7.1.0-dev.20261013.1, `tsc --watch` stays stale after that save too (3 of 3 runs):

```
08:27:35 PM - File change detected. Starting incremental compilation...

08:27:35 PM - Found 0 errors. Watching for file changes.
```

The script's summary line (7.0.2):

```
REPRODUCED: tsc --watch: save during the first build started 0 cycles, watch reports 0 TS2322 errors, fresh build 1, after saving another file 1; tsc -b --watch: save during the first build started 0 cycles, watch reports 0 TS2322 errors, fresh build 1, after saving another file 1;
```

### Impact

After a slow first build, the watch can show "Found 0 errors" for code that has errors (or keep errors that were
fixed), with no sign that it is stale, until an unrelated file is saved (on the nightly, `tsc --watch`: until that file is saved again).

### Cause

From reading the source at commit b85298b6 (line numbers at that commit; inferred, not traced at run time):

- `tsc --watch`: `Watcher.start` runs the first `doBuild` (`internal/execute/watcher.go:161`). `doBuild` reads the
  files in `NewProgram` (line 495), checks them (`compileAndEmit`, line 502), and only then creates the watches
  (`reconcileWatches`, line 520).
- `tsc -b --watch`: `Orchestrator.start` builds everything (`internal/execute/build/orchestrator.go:329`), then
  `Watch` creates the watches (`orchestrator.go:483-485`).
- Neither path compares the files' mtimes with the values recorded when they were read once the watches exist, so a
  change in between is lost. In `tsc --watch` the source file cache compares mtimes when a later cycle runs
  (`watcher.go:36-57`), which is likely why on 7.0.2 the next unrelated save picks the change up. Why the nightly's
  `tsc --watch` does not was not investigated; it may use the single-file fast path (`tryUpdateProgram`,
  `watcher.go:549-583`), which reuses every file except the one that had an event.

Creating the watches before reading the files, or rechecking the mtimes of the files read once the watches are in
place, would close the gap.
