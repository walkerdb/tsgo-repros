# 0020: `tsc -b --watch` re-reads the include directory tree on every file event

| | |
|-|-|
| Status | reproduces; not filed |
| Area | `tsc -b --watch` (and `tsc --watch` in 7.0.2) |
| Reproduces on | 7.0.2 (both modes), 7.1.0-dev.20261013.1, 7.1.0-beta, 7.1.0-dev.20261023.1 (`tsc -b --watch`) |
| Does not reproduce on | 7.1.0-dev.20261013.1, 7.1.0-beta, 7.1.0-dev.20261023.1 `tsc --watch` (0 directories read per edit) |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while `tsc -b --watch` reads the tree for an edit to a file already in the program, 0 once it does not. It
takes about 25 s and needs a Linux file system that records access times (the default `relatime` does; `noatime`
does not, and the script stops with an error then).

How it measures: reading a directory's entries updates its access time (atime) when the atime is older than 24 hours.
Before each edit the script sets the atime of all 201 directories under `src` to 2000-01-01; after the cycle, the
directories with a different atime are the ones tsgo read. Changing atime is not an event tsgo watches (its inotify mask
has no `IN_ATTRIB`), so the reset does not start anything by itself. The script does the same for a write to an unused
file (`notes.txt`) in the project directory.

## Bug report draft (for microsoft/TypeScript)

Title: `tsc -b --watch` re-reads all include directories on every file event

### Summary

On every batch of file events, `tsc -b --watch` expands the `include` wildcards of every project again, which reads
every directory under the include directories. It does this for an edit to a file that is already in the program, and
even for an event that starts no build at all (a write to a file no project uses). `tsc --watch` in
7.1.0-dev.20261013.1 does not do this for the same edit. With many directories under `include` the walk dominates
the cycle: with 20,000 empty directories under `src`, an edit to `src/a.ts` took 347-357 ms in `tsc -b --watch` and
5-13 ms in `tsc --watch` (7.1.0-dev.20261013.1, edit to "Watching for file changes", 5 edits each).

### Repro

```sh
mkdir -p proj/src && cd proj
echo '{}' > package.json
echo '{ "compilerOptions": { "noEmit": true, "strict": true, "types": [] }, "include": ["src"] }' > tsconfig.json
echo 'export const a: number = 0;' > src/a.ts
for i in $(seq 200); do mkdir src/d$i; echo notes > src/d$i/README.md; done
tsc -b --watch --preserveWatchOutput
# in another terminal, once the first build is done:
touch -a -d 2000-01-01 src src/d{1..200}   # reset directory access times (brace expansion reads no directory)
echo 'export const a: number = 1;' > src/a.ts
sleep 2; stat -c %X src src/d{1..200} | grep -vc "^$(date -d 2000-01-01 +%s)$"   # directories read since the reset
```

Expected: 0 directories read. `src/a.ts` is already a root of the project, and no directory changed.

Actual (script output):

```
7.1.0-dev.20261013.1:
tsc --watch: 0 0 0 of 201 directories read per edit, 0 after writing notes.txt (0 cycles);
tsc -b --watch: 201 201 201 of 201 directories read per edit, 201 after writing notes.txt (0 cycles)

7.0.2:
tsc --watch: 201 201 201 of 201 directories read per edit, 0 after writing notes.txt (0 cycles);
tsc -b --watch: 201 201 201 of 201 directories read per edit, 201 after writing notes.txt (0 cycles)
```

Timing with 20,000 empty directories under `src` (one-off measurement, not part of the script):

```
7.1.0-dev.20261013.1 tsc --watch    edit->done ms: 5 13 12 5 5
7.1.0-dev.20261013.1 tsc -b --watch edit->done ms: 347 355 355 347 357
7.0.2 tsc --watch                   edit->done ms: 145 144 142 142 136
7.0.2 tsc -b --watch                edit->done ms: 373 399 429 399 397
```

### Impact

Every save in `tsc -b --watch` pays for a walk of the whole include tree of every project in the build, and so does
every unrelated event in a watched directory (for example the build's own `.tsbuildinfo` write). On large repositories
this is tens to hundreds of milliseconds per event.

### Cause

Line numbers are at commit b85298b6 (2026-09-29); the npm builds may be from other commits.

`Orchestrator.DoCycle` (`internal/execute/build/orchestrator.go:818`) calls `checkTasksForEventChanges` for any
non-empty event batch. That function calls `task.resolved.ReloadFileNamesOfParsedCommandLine(o.host.FS())` for every
task unconditionally (orchestrator.go:646), which runs `getFileNamesFromConfigSpecs`
(`internal/tsoptions/tsconfigparsing.go:1934`) and its `vfsmatch.ReadDirectory` walk. The result is only used to
detect added or removed root files, which a content edit to an existing file, or a write to a file no glob matches,
cannot cause.

`tsc --watch` (`internal/execute/watcher.go`) reloads the file names only when `watchSetDirty` is set or on a full
program build (watcher.go:430, :485), so an edit that takes the single-file fast path does not walk the tree in
7.1.0-dev.20261013.1. 7.0.2 reads the tree in `tsc --watch` too.
