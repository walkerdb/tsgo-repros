# 0022: on macOS, a burst of writes under one watched directory overflows every watched directory

| | |
|-|-|
| Status | reproduces; not filed |
| Area | language server (`tsc --lsp --stdio`) builtin watcher, `internal/fswatch` FSEvents backend; macOS only |
| Reproduces on | 7.0.2, 7.1.0-dev.20261014.1 |
| Does not reproduce on | none known |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Needs macOS (on other platforms it prints "SKIPPED" and exits
77) and Node 22 (the LSP client is `lib/lsp-client.mjs`). Takes about 20 s.

## Bug report draft (for microsoft/TypeScript)

Title: On macOS, an FSEvents drop under one watched directory is reported as an overflow on every watched directory

### Summary

The FSEvents backend of `internal/fswatch` watches every root in a single FSEvents stream. When fseventsd falls
behind and drops events (`kFSEventStreamEventFlagMustScanSubDirs` with `UserDropped` or `KernelDropped`), macOS
reports the drop on every root of that stream, not only on the root where the events happened. Drops are per stream:
a second stream watching a quiet directory gets no drop at the same time. So one busy directory makes every watch in
the process report `ErrOverflow`.

In the language server's builtin watcher (used when the client does not support dynamic registration of
`workspace/didChangeWatchedFiles`), every overflowed watch logs `lspwatcher: watch overflow in "<dir>"`, and the
overflow invalidates what the session knows about files under it.

### Repro

Two directories, each with a `package.json` (so package.json lookups do not make the server watch a common
ancestor):

```
proj/package.json      {"name":"proj"}
proj/tsconfig.json     {"compilerOptions":{"strict":true,"noEmit":true,"types":[]},"include":["src"]}
proj/src/a.ts          import { x } from "../../shared/x"; export const y = x;
shared/package.json    {"name":"shared"}
shared/x.ts            export const x = 1;
```

Start `tsc --lsp --stdio` in `proj`, `initialize` with `capabilities: {}` (no dynamic watch registration), open
`src/a.ts` and send a hover so the project loads. The server watches `proj/`, `shared/` and its own `lib/`
directory. Then write and delete 20,000 files under `proj/busy/` until the server logs an overflow for `proj/`.

**Expected:** overflows are logged only for `proj/`, where the writes happened.

**Actual** (7.0.2 and 7.1.0-dev.20261014.1): every watched directory overflows, including `shared/` and the lib
directory, where nothing changed:

```
lspwatcher: watch overflow in "<work>/proj"
lspwatcher: watch overflow in "<tsgo>/node_modules/@typescript/typescript-darwin-arm64/lib"
lspwatcher: watch overflow in "<work>/shared"
REPRODUCED: writes only under proj/busy: 2 overflow(s) logged for proj/, 2 for shared/ (nothing changed there), after 1 round(s) of 20000 writes
```

### Impact

In a large workspace the server holds hundreds or thousands of watches. A single build, `git checkout` or package
install under one of them makes all of them overflow at once. Each one logs, and each overflow invalidates that watch's
cached state, so the work after a drop scales with the number of watches rather than with what changed. (In tsrs, a Rust
port of this package, this showed up on a large pnpm monorepo as a continuous loop of overflow lines, one per watch per
drop.) `tsc --watch` uses the same backend through `internal/execute/watchmanager`, where an overflow forces a full
rebuild; that path was not tested here.

### Cause

Line numbers are at commit 89d5d5b2 (2026-08-20).

- `startFSEventsStreams` (`internal/fswatch/fsevents_darwin.go:247`) starts one stream with every watched path
  (`:263`). It only splits paths into streams of `fseventsPathsPerStream` (512, `:225`) when creating that one
  stream fails.
- The stream callback, on `flagMustScanSubDirs` (`:516`), sets `ErrOverflow` on every watch for which
  `fseventsOverflowMatches(watch.w, path)` holds (`:530`, `:635`). macOS sends the drop event once for each root of
  the stream, so every watch matches its own root and every watch overflows.
- `lspwatcher` logs each overflow (`internal/lsp/lspwatcher/lspwatcher.go:325`).

A fix is to give each root its own stream, sharing streams only past a cap (a process can start at most 512 FSEvents
streams). The same fix in tsrs, a Rust port of this package, is maschwenk/tsrs#403.
