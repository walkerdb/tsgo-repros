# 0002: `--watch` builds twice during a large `git checkout`, and the first build can report false errors

| | |
|-|-|
| Status | reproduces; not filed |
| Area | `tsc --watch` |
| Reproduces on | 7.0.2, 7.1.0-dev.20261013.1 |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
FILES=10000 CHECKOUTS=6 ./repro.sh
```

`FILES` (default 3000) is the number of modules, `CHECKOUTS` (default 4) the number of branch switches, and `SETTLE`
(default 3) how many seconds of quiet output end a checkout. Exits 1 while the bug reproduces, 0 once it is fixed.

## Bug report draft (for microsoft/TypeScript)

**Title:** `tsc --watch` starts a build on the first file event of a `git checkout`, then builds again; the first build
can report errors from a half-written tree

### Summary

When a `git checkout` rewrites many files, `tsc --watch` starts a cycle on the first file event, while git is still
writing, and then runs a second cycle once the rest of the events arrive. The first cycle sees some files missing or
partially written and reports errors that don't exist in either branch, such as TS2307, TS2306, and TS6053. The second
cycle reports the correct result.

### Repro

`repro.sh` creates a git repo with 3000 modules, `src/m{i}.ts`, each importing the previous one, and a second branch
that appends a line to every file. It starts `tsc -p . --watch --preserveWatchOutput` and switches branches 4 times,
waiting for the output to go quiet after each switch. The project has no errors on either branch.

**Expected:** one build per checkout, and no errors.

**Actual:** 7.0.2 (Linux):

```
git checkout other: 1 builds
git checkout main: 2 builds
git checkout other: 2 builds
git checkout main: 2 builds
total: 7 builds for 4 checkouts; 2 errors reported (the project has none)
error TS6053: File '.../src/m1063.ts' not found.
src/m1271.ts(1,23): error TS2307: Cannot find module './m1270' or its corresponding type declarations.
```

7.1.0-dev.20261013.1 behaves the same:

```
total: 7 builds for 4 checkouts; 3 errors reported (the project has none)
error TS6053: File '.../src/m1096.ts' not found.
src/m1258.ts(1,23): error TS2306: File '.../src/m1257.ts' is not a module.
src/m1206.ts(1,23): error TS2306: File '.../src/m1205.ts' is not a module.
```

Each false-error cycle ends with "Found N errors. Watching for file changes."; the next cycle, a moment later, reports
"Found 0 errors".

### Impact

The first build of every large checkout is wasted work, and it prints errors that aren't real. Tools that act on watch
output, such as a `--watch` problem matcher in an editor's task runner, a script that stops on errors, or a person
reading the terminal, see the transient errors.

### Cause

The debounce in `tsc/internal/fswatch/debounce.go` fires on the leading edge. `notifyIfReady` (line 82, at b85298b6)
runs the callbacks immediately when more than `maxWaitTime` (500 ms) has passed since the last fire:

```go
if gap > maxWaitTime {
	d.lastTime = now
	d.mu.Unlock()
	d.fireCallbacks()
	return
}
d.mu.Unlock()
d.coalesceWait()
```

After an idle period, the first event of a burst fires at once instead of waiting `minWaitTime` (50 ms) for the burst to
end. The rest of the burst arrives while that build runs and causes the second build. Coalescing on the trailing edge
after idle too, by always waiting until there has been `minWaitTime` without events and capping the total wait at
`maxWaitTime`, should give one build per checkout here. (Not tested against a patched build.)
