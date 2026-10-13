# 0013: language server exits with status 1 after a clean shutdown and exit

| | |
|-|-|
| Status | reproduces; not filed |
| Area | language server (`tsc --lsp --stdio`) |
| Reproduces on | 7.0.2, 7.1.0-dev.20261013.1 |
| Does not reproduce on | none known |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Needs Node 22 (the LSP client is `lib/lsp-client.mjs`). It runs 10
sessions: 5 keep stdin open after `exit`, 5 close it right after `exit`. Takes about 10 s.

## Bug report draft (for microsoft/TypeScript)

Title: Language server exits with status 1 and prints "context canceled" after shutdown + exit

### Summary

After a client sends the `shutdown` request, gets its response, and then sends the `exit` notification, `tsc --lsp
--stdio` exits with status 1 and prints `context canceled` to stderr. The LSP spec says the server should exit with
code 0 when `shutdown` was received before `exit`. The status is 0 only when the client closes stdin quickly enough
after `exit` to win a race inside the server.

### Repro

```sh
mkdir -p proj/src && cd proj
echo '{ "compilerOptions": { "noEmit": true, "strict": true }, "include": ["src"] }' > tsconfig.json
echo 'export const a: number = 1;' > src/a.ts
```

Start `tsc --lsp --stdio` in `proj` and send, over stdio:

1. `initialize` (any capabilities), then `initialized`
2. `textDocument/didOpen` for `src/a.ts` and a `textDocument/hover` (optional; same result without them)
3. `shutdown` (no params); the server answers `null`
4. `exit` (no params); keep stdin open and wait for the process to exit

Expected: the process exits with status 0.

Actual (7.0.2 and 7.1.0-dev.20261013.1):

```
run 1 (stdin open after exit): shutdown -> null; exit status 1; last stderr line: "context canceled"
run 2 (stdin closed after exit): shutdown -> null; exit status 0; last stderr line: "error handling method 'exit': EOF"
run 3 (stdin open after exit): shutdown -> null; exit status 1; last stderr line: "context canceled"
run 4 (stdin closed after exit): shutdown -> null; exit status 1; last stderr line: "context canceled"
...
REPRODUCED: nonzero exit status after shutdown+exit in 5/5 runs with stdin kept open (statuses 1,1,1,1,1) and 1/5 runs with stdin closed after exit (statuses 0,1,0,0,0)
```

With stdin kept open the status is 1 every time. When stdin is closed right after `exit`, it is 1 in about 1 to 2 of 5
runs. Even the clean runs log `error handling method 'exit': EOF` as an error.

### Impact

Clients and tools that check the server's exit status see an abnormal exit on every normal shutdown. Scripts and test
harnesses that drive the server and check its status see a failure. The `context canceled` line on stderr looks like
an error in editor logs.

### Cause

Line numbers are at commit b85298b6 (2026-09-29).

- `handleExit` returns `io.EOF` (`internal/lsp/server.go:1796-1797`). It is logged as an error (`:1162`).
- `dispatchLoop` treats `io.EOF` as "exit" and calls `lspExit(nil)` (`:996`), which cancels the dispatch loop's
  context. The next `s.requestQueue.Get(ctx)` (`:972`) returns `context.Canceled`, and `dispatchLoop` returns it.
- `Run` filters only `io.EOF` (`:877`): `g.Wait()` returns `context.Canceled`, so `Run` returns it, and `runLSP`
  prints it and returns 1 (`cmd/tsc/lsp.go:69-71`).
- The status is 0 only if the read loop sees stdin EOF and returns `io.EOF` to the errgroup before the dispatch loop
  returns `context.Canceled`.

A fix could have `dispatchLoop` return `io.EOF` (or nil) after an `exit` notification instead of the canceled
context's error, or have `Run` treat cancellation caused by `exit` as a clean exit. The spec also says to exit with
code 1 if `exit` arrives without a prior `shutdown`; the server does not seem to track that (inferred from source,
not tested).
