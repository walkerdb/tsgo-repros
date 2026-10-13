# 0001: watch misses edits to files under a symlinked directory

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

Exits 1 while the bug reproduces, 0 once it is fixed. It needs `ln -s`; tested on Linux only.

## Bug report draft (for microsoft/TypeScript)

Title: `--watch` never sees edits to files under a symlinked directory inside an `include` directory

### Summary

When a directory matched by `include` contains a symlink to a directory elsewhere, the files reached through the
symlink are program files, but editing them never starts a watch cycle, in `tsc --watch` and in `tsc -b --watch`.
This holds whether the file is edited through its real path or through the symlink. The watch keeps reporting the old
diagnostics until some other file changes.

This is common in monorepos and in projects that link shared source into `src` (for example `src/shared ->
../../shared`).

Symlinked packages under `node_modules` are not affected in `tsc --watch`: module resolution uses the real path and
its directory gets its own watch. (In `tsc -b --watch` on a project without `incremental` or `composite`, edits to
files under `node_modules` are missed whether or not they are symlinked; that looks like a separate bug.)

### Repro

On Linux:

```sh
mkdir -p proj/src proj/shared && cd proj
echo '{ "type": "module" }' > package.json
echo '{ "compilerOptions": { "noEmit": true, "strict": true, "types": [] }, "include": ["src"] }' > tsconfig.json
echo 'import { b } from "./linked/b.js"; export const a: number = b;' > src/a.ts
echo 'export const b: number = 1;' > shared/b.ts
ln -s ../shared src/linked

tsc --watch --preserveWatchOutput &       # or: tsc -b --watch --preserveWatchOutput &
sleep 2
echo 'export const b: string = "real";' > shared/b.ts        # through the real path
sleep 2
echo 'export const b: string = "link";' > src/linked/b.ts    # through the symlink
sleep 2
echo '// touched' >> src/a.ts                                  # control
```

`tsc --listFiles` shows `src/linked/b.ts` is in the program.

Expected: each edit of `b.ts` starts one cycle that reports
`src/a.ts(1,49): error TS2322: Type 'string' is not assignable to type 'number'.`

Actual (7.0.2 and 7.1.0-dev.20261013.1, both modes): the two edits of `b.ts` start no cycle; only the control edit
of `src/a.ts` does, and that cycle shows the error:

```
08:22:34 PM - Starting compilation in watch mode...

08:22:34 PM - Found 0 errors. Watching for file changes.

08:22:39 PM - File change detected. Starting incremental compilation...

src/a.ts(1,49): error TS2322: Type 'string' is not assignable to type 'number'.
08:22:39 PM - Found 1 error. Watching for file changes.
```

The script's summary line:

```
REPRODUCED: tsc --watch: real-path edit 0 cycles, link-path edit 0 cycles, control edit 1 cycles; tsc -b --watch: real-path edit 0 cycles, link-path edit 0 cycles, control edit 1 cycles; expected 1 cycle per edit
```

### Impact

Watch mode shows stale errors (or misses new ones) for every file under a symlinked source directory, silently. The
user has to edit an unrelated file or restart the watch.

### Cause

From reading the source at commit b85298b6 (line numbers at that commit; inferred, not traced at run time):

- `include: ["src"]` gives a recursive watch on `src` (`internal/execute/watcher.go:213-217`; `-b`:
  `internal/execute/build/orchestrator.go:710-714`).
- The program file `src/linked/b.ts` keeps its symlink path. Its directory `src/linked` counts as covered by the
  recursive watch on `src` (`watcher.go:260-263`, `DirWatchSet.Covered` in
  `internal/execute/watchmanager/watchmanager.go:332`; `-b`: `orchestrator.go:717-719`, `783`), so it gets no watch of
  its own.
- The inotify backend adds one watch per directory by walking the tree (`internal/fswatch/inotify_linux.go:225`), and
  the walk does not follow symlinks (`internal/fswatch/walkdir_unix.go:56-59`: `O_NOFOLLOW`, only `DT_DIR` entries
  are descended). So no inotify watch covers `shared/`, and inotify reports events on the real directory's watch only,
  whichever path the editor used.

A fix could give each directory symlink found under a recursive watch (or the real path of each program file whose
directory is a symlink) its own watch.
