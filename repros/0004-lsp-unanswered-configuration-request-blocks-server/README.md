# 0004: an unanswered workspace/configuration request blocks the language server

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

Exits 1 while the bug reproduces, 0 once it is fixed. Needs Node 22 (the LSP client is `lib/lsp-client.mjs`). Takes
about 15 s.

## Bug report draft (for microsoft/TypeScript)

Title: Language server handles no requests until the client answers workspace/configuration

### Summary

When the client advertises `workspace.configuration`, the server sends a `workspace/configuration` request while it
handles the `initialized` notification, and waits for the answer on its single dispatch loop. Until the client
answers, every later request and notification is queued and not handled. If the client answers late, every request
is delayed by that long. If it never answers, the server never answers anything again. Sending `$/cancelRequest` for
the hover does not help either (tried on 7.0.2: still no response after 5 s), since the source cancels only requests
that were already dispatched.

### Repro

```sh
mkdir -p proj/src && cd proj
echo '{ "compilerOptions": { "noEmit": true, "strict": true }, "include": ["src"] }' > tsconfig.json
echo 'export const a: number = 1;' > src/a.ts
```

Start `tsc --lsp --stdio` in `proj` and send:

1. `initialize` with `capabilities: { workspace: { configuration: true } }`, then `initialized`
2. the server sends `workspace/configuration`; do not answer it (or answer it after 3 s)
3. `textDocument/didOpen` for `src/a.ts`, then `textDocument/hover` on `a`

Expected: the hover is answered promptly. The server can apply defaults until the configuration arrives, as it does
for clients without `workspace.configuration`.

Actual (7.0.2 and 7.1.0-dev.20261013.1):

```
never: hover no response within 10000 ms; server-to-client requests seen: workspace/configuration
delayed: hover answered in 3048 ms: "const a: number"; server-to-client requests seen: workspace/configuration, client/registerCapability
prompt: hover answered in 42 ms: "const a: number"; server-to-client requests seen: workspace/configuration, client/registerCapability
```

The hover is answered only after the configuration answer arrives, and the follow-up `client/registerCapability`
request is only sent then.

### Impact

A client that is slow to answer `workspace/configuration` (for example, because it reads settings asynchronously, or
answers server requests only after its own startup finishes) stalls the whole server for that long. A client with a
bug that drops the request leaves the server permanently unresponsive, with no error and nothing in the log that
points at the cause. LSP does not require clients to answer server requests before sending more requests.

### Cause

Line numbers are at commit b85298b6 (2026-09-29).

- `handleInitialized` (`internal/lsp/server.go:1677`) is registered as a notification handler (`:1233`), so it runs
  synchronously on `dispatchLoop`. It calls `s.RequestConfiguration(ctx)` (`:1751`) and then `sendClientRequest` for
  `client/registerCapability` (`:1757`).
- `RequestConfiguration` calls `sendClientRequest` (`:817`), which blocks until the response arrives or `ctx` is done
  (`:1076-1078`). The notification's context has no cancel function, so it only ends when the server shuts down.
- The comment on `sendClientRequest` (`:1051`) says it "should only be called in the async portion of a request
  handler, otherwise a deadlock can occur". `handleInitialized` calls it from the synchronous part.

A possible fix is to request configuration asynchronously (start with default preferences and apply the answer when it
arrives), or to put a timeout on the request.
