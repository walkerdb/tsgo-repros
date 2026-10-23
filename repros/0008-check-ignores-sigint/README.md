# 0008: tsc keeps type checking after SIGINT or SIGTERM

| | |
|-|-|
| Status | reproduces; not filed |
| Area | `tsc` CLI, signal handling |
| Reproduces on | 7.0.2, 7.1.0-dev.20261013.1, 7.1.0-beta, 7.1.0-dev.20261023.1 (all tested) |
| Does not reproduce on | not known |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. The script generates a project that takes several seconds to check,
runs it once without a signal, then sends SIGINT (and SIGTERM, and SIGINT with `--incremental` and with `--watch`) 2 s
after start and measures how long the process takes to exit. It reproduces when the plain `tsc -p` takes over 1 s and
over half of the remaining check time to exit. The whole script takes about a minute.

## Bug report draft (for microsoft/TypeScript)

Title: tsc ignores Ctrl+C (SIGINT) and SIGTERM until the whole type check is done

### Summary

`tsc -p .` catches SIGINT and SIGTERM but does not stop. It finishes type checking, prints its diagnostics and exits
with its normal status (0 here). On a large project, Ctrl+C does nothing for minutes. The same happens with
`--incremental` and during the first build of `--watch`.

### Repro

Generate 64 copies of a function whose control flow analysis is slow (about 10 s of checking in total, under 300 MB):

```sh
mkdir -p src
{
	printf 'declare function c(): boolean;\ndeclare function use(v: unknown): void;\n'
	printf 'export function g(x: string | number | boolean | undefined) {\n'
	for j in $(seq 1 1600); do printf '\tif (c()) { x = %s; }\n\tuse(x);\n' "$j"; done
	printf '}\n'
} > src/f1.ts
for i in $(seq 2 64); do cp src/f1.ts src/f$i.ts; done
echo '{ "compilerOptions": { "strict": true, "noEmit": true, "types": [] }, "include": ["src"] }' > tsconfig.json

tsc -p . & pid=$!; sleep 2; kill -INT $pid; time wait $pid
```

Expected: the process exits within a fraction of a second of the signal, with a non-zero status. TypeScript 5.9.3 on
the same project, sent SIGINT at 2 s, exited at 2.04 s with status 130.

Actual (7.1.0-dev.20261013.1; the full check takes 9.3 s):

```
no signal: check finished after 9254 ms (exit 0)
SIGINT: sent at 2 s, exited 7257 ms later (exit 0)
SIGTERM: sent at 2 s, exited 7361 ms later (exit 0)
SIGINT with --incremental: sent at 2 s, exited 7343 ms later (exit 0)
SIGINT with --watch: sent at 2 s, exited 7382 ms later (exit 0)
```

7.0.2 behaves the same (full check 10.9 s; 8.6-8.8 s from the signal to exit in all four cases).

### Impact

Ctrl+C in a terminal does not stop a long check. Tools that stop `tsc` with SIGTERM (task runners, editors, CI
timeouts) wait for the whole check, and only SIGKILL works. Exit status 0 after a signal also hides that the run was
interrupted.

### Cause

From the source at commit b85298b6 (line numbers at that commit).

`cmd/tsc/main.go:29` creates the context with `signal.NotifyContext(context.Background(), syscall.SIGINT,
syscall.SIGTERM)`. Once `NotifyContext` is registered, Go no longer applies the default action (exit) for these
signals; it only cancels the context. That context is passed to `execute.CommandLine`, but the check and emit do not
use it: `EmitFilesAndReportErrors` replaces it with `ctx := context.Background()` (`internal/execute/tsc/emit.go:76`)
and passes that to `GetDiagnosticsOfAnyProgram` and `Emit`. So nothing observes the cancellation until the run
returns. The watch loop does check the context (`internal/execute/watchmanager/watchmanager.go:367`), which is why
`--watch` exits after its first build rather than continuing to watch.
