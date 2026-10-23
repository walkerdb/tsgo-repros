# 0024: without a package.json, the language server asks to watch all of /Users (macOS)

| | |
|-|-|
| Status | reproduces; not filed |
| Area | language server (`tsc --lsp --stdio`) watch globs; macOS |
| Reproduces on | 7.0.2, 7.1.0-dev.20261014.1 (macOS) |
| Does not reproduce on | a local build with the fix below |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Needs macOS (on other platforms it prints "SKIPPED" and exits
77), Node 22 (the LSP client is `lib/lsp-client.mjs`) and the repo checked out under `$HOME`. Takes about 15 s. Linux
already excludes `/home/<name>`, so the bug can't show there; 7.0.2 does not reproduce on Linux.

## Bug report draft (for microsoft/TypeScript)

Title: On macOS, the language server watches all of /Users when package.json lookups climb out of the project

### Summary

The server watches the locations its package.json and module lookups visited, so that it notices when a missing
file appears. Locations outside the workspace are merged into their common parents, and locations at or above the
user's home directory are meant to be ineligible: `perceivedOsRootLengthForWatching` treats `C:/Users/<name>` and
`/home/<name>` as part of the root. macOS's `/Users/<name>` is not handled, so `/Users` is an ordinary directory of
depth 2, which meets `minWatchLocationDepth`. When the lookups climb to the root (a project with no `package.json`
of its own, or a file whose directories up to the root have none), their common parent is `/Users`, and the server
asks the client to watch `/Users/**/*`.

### Repro

```
proj/tsconfig.json   {"compilerOptions":{"strict":true,"noEmit":true,"types":[]},"include":["src"]}
proj/src/a.ts        export const a = 1;
```

`proj` is anywhere under the home directory and has no `package.json`. Start `tsc --lsp --stdio` in `proj`,
`initialize` with `capabilities.workspace.didChangeWatchedFiles: { dynamicRegistration: true,
relativePatternSupport: true }`, open `src/a.ts` and send a hover so the project loads. Read the watchers in the
`client/registerCapability` requests for `workspace/didChangeWatchedFiles`. As a control, do the same with a
`package.json` in `proj`.

**Expected:** no watcher covers the home directory or anything above it.

**Actual** (7.0.2 and 7.1.0-dev.20261014.1, macOS):

```
bare: 3 recursive watcher(s); at or above $HOME: /Users/**/*
control: 2 recursive watcher(s); none at or above $HOME
REPRODUCED: without a package.json the server asks the client to watch /Users/**/* ($HOME is /Users/walker); with one, nothing at or above $HOME
```

The watcher is `{ "baseUri": "file:///Users", "pattern": "**/*" }` (7.0.2 sends `file:///users`). With the builtin
watcher (a client without dynamic registration), the server watches `/Users` recursively itself; the server log
shows `Added new watch: program files ... /users/**/*`.

### Impact

The client (or the server's own watcher) watches every directory of every user on the machine, and every file write
under the home directory (browser caches, other repositories, builds, package installs) is delivered to the server as
a watch event, which it then has to filter. With the builtin FSEvents watcher a busy home directory also makes
fseventsd drop events, and each drop overflows every watch (0022). Any project under the home directory whose
package.json lookups reach the root triggers it, including one opened as loose files without a `package.json`.

### Cause

Line numbers are at commit 89d5d5b2 (2026-08-20).

- `createResolutionLookupGlobMapper` (`internal/project/watch.go:298`) collects lookup locations outside the
  workspace (`:331`) and merges them with `tspath.GetCommonParents` at `minWatchLocationDepth` (2, `:19`; `:361`).
- The components it counts come from `getPathComponentsForWatching`, which joins the first
  `perceivedOsRootLengthForWatching` components into the root (`:434`). That function groups `C:/Users/<name>`
  (`:445`) and `/home/<name>` (`:451`), but not `/Users/<name>`, so on macOS `/Users` counts as depth 2 and is
  eligible.

Fix: group `/Users/<name>` too, for example with `if strings.EqualFold(pathComponents[1], "users") { return min(3,
length) }` before the `/home` check. With that change built from source, this repro passes: the same lookups merge
into the first directory under the home directory (`/Users/walker/code/**/*` here), as they would under `/home/<name>`
on Linux.
