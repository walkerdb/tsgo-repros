# 0015: --traceResolution output differs from run to run

| | |
|-|-|
| Status | reproduces; not filed |
| Area | `tsc --traceResolution`, module resolution |
| Reproduces on | 7.0.2, 7.1.0-dev.20261013.1 (both tested) |
| Does not reproduce on | `--singleThreaded` (same versions); TypeScript 5.9.3 |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. The script runs `tsc -p . --traceResolution` 10 times and
counts distinct outputs, and distinct outputs after sorting their lines.

This repro was first noted as "the trace output order varies". That is not what happens: the traces are printed in a
stable order (per file, in program order), and the content varies. Sorting the lines does not make the outputs equal.
The directory name says "nondeterministic" for that reason.

## Bug report draft (for microsoft/TypeScript)

Title: `--traceResolution` output changes between runs on the same project

### Summary

With the default parallel file loading, `--traceResolution` prints different text on each run of the same project.
Which resolution reports `Found 'package.json' at ...` and which reports `File '.../package.json' exists according to
earlier cached lookups.` depends on thread timing. With `--singleThreaded`, the output is the same every run.

### Repro

40 source files, each importing the same 10 packages:

```sh
mkdir -p src node_modules
for p in $(seq 1 10); do
	mkdir node_modules/pkg$p
	echo "{ \"name\": \"pkg$p\", \"version\": \"1.0.0\", \"types\": \"index.d.ts\" }" > node_modules/pkg$p/package.json
	echo "export declare const v$p: number;" > node_modules/pkg$p/index.d.ts
done
for i in $(seq 1 40); do
	{ for p in $(seq 1 10); do echo "import { v$p } from \"pkg$p\";"; done; echo "export const s$i = v1;"; } > src/a$i.ts
done
echo '{ "compilerOptions": { "strict": true, "noEmit": true, "types": [], "module": "nodenext" }, "include": ["src"] }' > tsconfig.json

for r in 1 2 3; do tsc -p . --traceResolution | md5sum; done
for r in 1 2 3; do tsc -p . --traceResolution | grep -c "^Found 'package.json'"; done
```

Expected: identical output on every run. TypeScript 5.9.3 prints the same output each time, with 11
`Found 'package.json'` lines; tsgo with `--singleThreaded` prints the same output each time, with 10.

Actual (7.0.2; 10 runs gave 10 different outputs, also after sorting the lines):

```
"Found 'package.json'" lines per run: 39 20 35 31 32 39 41 38 33 39 (10 packages)
first difference between run 1 and run 2:
302c302
< Found 'package.json' at '<project>/node_modules/pkg2/package.json'.
---
> File '<project>/node_modules/pkg2/package.json' exists according to earlier cached lookups.
```

7.1.0-dev.20261013.1: 10 of 10 outputs differ; `Found 'package.json'` lines per run: 22 38 40 43 41 21 35 35 38 39.

### Impact

Resolution traces cannot be diffed between runs or machines, which is the usual way to debug a resolution change.
Tools and tests that snapshot `--traceResolution` output are flaky.

### Cause

From the source at commit b85298b6 (line numbers at that commit).

When tracing is on, `resolveModuleName` skips the module resolution cache so that every resolution is traced
(`internal/module/resolver.go:268-272`). Files are parsed and resolved in parallel, and each resolution's trace is
buffered and printed later in file order (`internal/compiler/filesparser.go:440-445`), so the order is stable.
`getPackageJsonInfo` (`internal/module/resolver.go:1754-1799`) is a check-then-act on the shared
`packageJsonInfoCache`: it calls `Get` (`:1757`), and on a miss reads the file, traces `Found 'package.json' at ...`
(`:1777`) and calls `Set` (`:1787`). Several goroutines can miss at the same time, and all of them trace "Found", while
the ones that run later trace "exists according to earlier cached lookups". Which file gets which line depends on
scheduling.
