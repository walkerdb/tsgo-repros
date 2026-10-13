# 0005: watch compiles a save that is still being written

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

Exits 1 while the bug reproduces, 0 once it is fixed. Needs `node` (for `write-pieces.js`, which truncates a file and
writes it in timed pieces). Takes about 45 s.

## Bug report draft (for microsoft/TypeScript)

Title: `--watch` compiles a file that is still being written, reports false errors, then compiles again

### Summary

The watch starts a cycle on the first file event after a quiet period, without waiting. If a save is not a single
write (the file is truncated, then written a few milliseconds later, or written in pieces), the first cycle reads the
file empty or half-written and reports errors the saved file does not have. Then the remaining events start one or
more further cycles, and the last one is correct.

A gap of 5 ms between the truncate and the write is enough. A single `open(O_TRUNC)` + `write` + `close` (for
example `fs.writeFileSync`) gives one cycle.

### Repro

On Linux:

```sh
mkdir -p proj/src && cd proj
echo '{ "type": "module" }' > package.json
echo '{ "compilerOptions": { "noEmit": true, "strict": true, "types": [] }, "include": ["src"] }' > tsconfig.json
echo 'import { b } from "./b.js"; export const a: number = b;' > src/a.ts
echo 'export const b: number = 1;' > src/b.ts
tsc --watch --preserveWatchOutput &      # or: tsc -b --watch --preserveWatchOutput &
sleep 2
# Truncate, wait 5 ms, write the new text:
node -e '
  const fs = require("fs");
  const fd = fs.openSync("src/b.ts", "w");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  fs.writeSync(fd, "export const b: number = 2;\n");
  fs.closeSync(fd);'
```

Expected: one cycle, `Found 0 errors.`

Actual (7.0.2): two cycles; the first one compiled the empty file:

```
08:20:24 PM - File change detected. Starting incremental compilation...

src/a.ts(1,19): error TS2306: File '/.../proj/src/b.ts' is not a module.
08:20:25 PM - Found 1 error. Watching for file changes.

08:20:25 PM - File change detected. Starting incremental compilation...

08:20:25 PM - Found 0 errors. Watching for file changes.
```

With the text written in 4 pieces 100 ms apart, `tsc --watch` runs 5 cycles for one save, and the middle ones report
errors such as `TS1155: 'const' declarations must be initialized.` and `TS2304: Cannot find name 'n'.`

Cycles per save on 7.0.2, `tsc --watch` (the pause comes after the truncate and before each piece):

| pause | pieces | cycles per save |
|-|-|-|
| 0 ms | 1, 2, 4 | 1 |
| 2-30 ms | 1, 2, 4 | 2 |
| 60-300 ms | 1 | 2 |
| 60-300 ms | 2 | 3 |
| 60-300 ms | 4 | 5 |

The script's summary line (3 saves per pattern):

```
REPRODUCED: tsc --watch: 0ms x 1: 3 cycles / 3 saves, 0 with wrong errors; 5ms x 1: 6 cycles / 3 saves, 3 with wrong errors; 300ms x 1: 6 cycles / 3 saves, 3 with wrong errors; 100ms x 4: 15 cycles / 3 saves, 6 with wrong errors; tsc -b --watch: 0ms x 1: 3 cycles / 3 saves, 0 with wrong errors; 5ms x 1: 6 cycles / 3 saves, 3 with wrong errors; 300ms x 1: 6 cycles / 3 saves, 3 with wrong errors; 100ms x 4: 9 cycles / 3 saves, 3 with wrong errors; (expected 1 cycle per save and 0 errors)
```

### Impact

Editors, formatters and other tools that do not write a file in one system call make the watch flash false errors
and do the work of two or more cycles per save. In a large project each extra cycle can take seconds, and a full
rebuild triggered by an empty file (a module that is suddenly not a module) is expensive.

### Cause

From reading the source at commit b85298b6 (line numbers at that commit; inferred, not traced at run time):

`internal/fswatch/debounce.go:82-94`: when an event arrives more than `maxWaitTime` (500 ms, line 10) after the last
batch, `notifyIfReady` fires the callbacks at once, with no quiet period. Only events within 500 ms of the last batch
wait for `minWaitTime` (50 ms, line 9) of quiet (`coalesceWait`, lines 96-106). So the truncate of a save after an
idle period is delivered alone, the watch manager signals a cycle (`internal/execute/watchmanager/watchmanager.go:104-144`),
and the cycle reads the file before the rest of the save lands. Later pieces arrive within 500 ms and are coalesced
only if they are less than 50 ms apart.

Waiting for the 50 ms quiet period before the first batch too would merge saves with short gaps into one cycle.
Pieces written more than 50 ms apart would still start several cycles; telling them from separate saves needs a
longer quiet period.
