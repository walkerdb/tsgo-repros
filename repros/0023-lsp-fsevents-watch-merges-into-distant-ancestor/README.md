# 0023: on macOS, crowded watches merge into a recursive watch on a distant ancestor

| | |
|-|-|
| Status | reproduces; not filed |
| Area | language server (`tsc --lsp --stdio`) builtin watcher, `internal/fswatch` watch consolidation; macOS only |
| Reproduces on | 7.0.2, 7.1.0-dev.20261014.1 |
| Does not reproduce on | none known |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Needs macOS (on other platforms it prints "skipped" and exits
0) and Node 22 (the LSP client is `lib/lsp-client.mjs`). Takes about 35 s.

## Bug report draft (for microsoft/TypeScript)

Title: On macOS, the file watcher merges watches into a recursive watch on an ancestor far above them

### Summary

With the FSEvents backend, `internal/fswatch` merges watches into one recursive watch on a parent directory once
`recursiveConsolidateThreshold` (10) watches sit under it. To pick the parent for a new watch, it walks up the new
watch's ancestors and counts every existing watch anywhere under each one. So a single crowded subtree, such as the
packages of a pnpm store, makes every ancestor of that subtree qualify. The next watch elsewhere whose ancestors reach
one of them becomes a recursive watch on that ancestor, even though only a few of its children hold watches. On a
developer machine the chain can reach the home directory: after that, every write anywhere under it is delivered to the
language server.

### Repro

A pnpm-style layout with 10 packages in a store, linked from the project, plus an import from a sibling directory.
Every directory that holds files has a `package.json`, so package.json lookups do not climb out on their own:

```
store/p0/node_modules/pkg0/{package.json,index.d.ts}   ... through p9/pkg9
proj/node_modules/pkg0 -> ../../store/p0/node_modules/pkg0   ... through pkg9
proj/package.json, proj/tsconfig.json ("types": [], "module": "esnext", "moduleResolution": "bundler")
proj/src/a.ts          imports pkg0 through pkg9 and "../../shared/x"
shared/{package.json,x.ts}
unrelated/             empty; nothing in the project refers to it
```

Start `tsc --lsp --stdio` in `proj`, `initialize` with `capabilities: {}` (no dynamic watch registration), open
`src/a.ts` and send a hover so the project loads. Then write and delete 20,000 files in `unrelated/`. As a control,
do the same with 3 store packages, which is too few to merge.

**Expected:** no watch covers `unrelated/`, so the writes are not seen by the server and nothing is logged.

**Actual** (7.0.2 and 7.1.0-dev.20261014.1): with 10 packages, the writes reach the server, fseventsd drops events,
and every watch overflows. With 3 packages, nothing is logged:

```
crowded: 10 store packages, 13 watches; writes in unrelated/ (1 round(s) of 20000): 28 overflow line(s) for 14 watched director(ies)
control: 3 store packages, 6 watches; writes in unrelated/ (3 round(s) of 20000): 0 overflow line(s) for 0 watched director(ies)
REPRODUCED: writes in a directory no watch covers: 28 overflow line(s) with 10 store packages (a recursive watch covers their common ancestor), 0 with 3
```

That every watch overflows, not only the merged one, is 0022.

### Impact

Wherever one subtree holds many watches (a pnpm store, a monorepo's packages), the merge can climb from it to any
ancestor that a later watch passes through, as far as the directory below the filesystem root. Every file event
under that ancestor then reaches the language server, and on a busy ancestor FSEvents drops events often, which
overflows every watch (0022). In tsrs, a Rust port of this package with the same logic, opening one file of a large
pnpm monorepo was enough for the merge to climb from a store package through the store's `links/@` and `links/`
directories to the user's home directory, after which the server logged overflows in a continuous loop with the
editor idle. That climb was not measured with tsgo itself; the repro above shows the same mechanism.

### Cause

Line numbers are at commit 89d5d5b2 (2026-08-20).

- `getOrCreateDirWatch` (`internal/fswatch/watcher.go:433`) calls `findConsolidationDirLocked` for each new watch
  and, if it returns a directory, watches that directory recursively instead.
- `findConsolidationDirLocked` (`:387`) walks up from the new watch's parent. For each ancestor it counts every
  existing watch whose directory is anywhere under it (`:402`), and returns the first ancestor where the count
  reaches `recursiveConsolidateThreshold` (`:404`, `:314`). Only the filesystem root stops the walk.

A fix is to count the distinct children of the candidate parent that hold watches (on the path from the parent to
each watch), so a merge only happens when watches are spread across many siblings. The same fix in tsrs, a Rust port
of this package, is maschwenk/tsrs#403.
