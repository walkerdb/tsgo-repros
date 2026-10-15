# 0025: malformed client input makes the language server panic and exit with status 2

| | |
|-|-|
| Status | reproduces; not filed |
| Area | language server (`tsc --lsp --stdio`) |
| Reproduces on | 7.0.2 (13 of 13 inputs), 7.1.0-dev.20261014.1 (11 of 13 inputs) |
| Does not reproduce on | none known; two of the inputs no longer crash on 7.1.0-dev.20261014.1 (see below) |
| Upstream | not filed yet |

Found by a differential audit (maschwenk/tsrs PR #513) against tsgo at commit b85298b6a81f. That audit said each of
these inputs makes tsgo panic and exit with status 2. This repro checks each input on its own.

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while any input kills the server, 0 once none do. Needs Node 22 (the LSP client is `lib/lsp-client.mjs`). Each
input gets a fresh server session. A control session (a plain hover) must stay up, or the script exits 2. Takes about
15 s. `node repro.mjs <workdir> <text>` runs only the cases whose name contains `<text>`.

| Input | 7.0.2 | 7.1.0-dev.20261014.1 | First `panic:` line |
|-------|-------|----------------------|---------------------|
| `textDocument/hover`, uri `untitled` | exit 2 | exit 2 | `invalid URI: untitled` |
| `textDocument/hover`, uri `file:///%zz.ts` | exit 2 | exit 2 | `invalid file URI: file:///%zz.ts` |
| `textDocument/hover`, uri `foo://bar` | exit 2 | error -32603, keeps running | `invalid URI: foo://bar` |
| `textDocument/didOpen`, uri `untitled` | exit 2 | exit 2 | `invalid URI: untitled` |
| `workspace/willRenameFiles`, newUri `untitled` | exit 2 | exit 2 | `invalid URI: untitled` |
| `workspace/didChangeWatchedFiles`, uri `untitled` | exit 2 | exit 2 | `invalid URI: untitled` |
| `callHierarchy/incomingCalls`, item.uri `untitled` | exit 2 | exit 2 | `invalid URI: untitled` |
| `callHierarchy/outgoingCalls`, item.uri `untitled` | exit 2 | exit 2 | `invalid URI: untitled` |
| `didClose` then `didChange` of the same document | exit 2 | exit 2 | `should see no changes after close` |
| `completionItem/resolve`, `data.fileName: ""` | exit 2 | error -32603, keeps running | `vfs: path "tsconfig.json" is not absolute` |
| `codeLens/resolve` without `data` | exit 2 | exit 2 | `runtime error: invalid memory address or nil pointer dereference` |
| `textDocument/hover` before `initialized` | exit 2 | exit 2 | `runtime error: invalid memory address or nil pointer dereference` |
| `initialize` with rootUri `untitled` | exit 2 | exit 2 | `invalid URI: untitled` |

In every crash the process exits with status 2 (no signal), a pending request gets no response, and the server answers
nothing after that. When the server keeps running, the follow-up hover is answered.

Inputs that were tried and answered normally on both versions, so they are not in the script:

- `completionItem/resolve` with a relative `data.fileName` (`"a.ts"`): error -32603 (`no project found for URI
  file://a.ts` on 7.0.2, `completion item data fileName must be absolute` on the nightly).
- `textDocument/didOpen` between `initialize` and `initialized`: dropped with ServerNotInitialized; the server keeps
  running. Only requests that go through the language service handlers crash before `initialized`.
- `textDocument/didClose` without a following `didChange`: no crash.

## Bug report draft (for microsoft/TypeScript)

Title: Language server panics and exits on malformed client input (bad URIs, didChange after didClose, requests
before initialized, resolve without data)

### Summary

Several kinds of bad input from an LSP client make `tsc --lsp --stdio` panic. The process exits with status 2, so the
editor loses the server, and every open request is dropped. The server should answer with an error (InvalidParams, or
ServerNotInitialized before `initialized`) and keep running. The inputs:

- A URI that `lsproto.DocumentUri.FileName` cannot convert, in a request (`textDocument/hover`, call hierarchy
  items, `workspace/willRenameFiles`), a notification (`textDocument/didOpen`, `workspace/didChangeWatchedFiles`), or
  the `rootUri` of `initialize`. `untitled` (no scheme) and `file:///%zz.ts` (bad percent escape) are enough.
- `textDocument/didChange` right after `textDocument/didClose` of the same document. The panic happens in the
  debounced snapshot update, with no further request.
- A language service request (such as `textDocument/hover`) after `initialize` but before `initialized`.
- `codeLens/resolve` with a CodeLens that has no `data`.

### Repro

```sh
mkdir -p proj/src && cd proj
echo '{ "compilerOptions": { "noEmit": true, "strict": true }, "include": ["src"] }' > tsconfig.json
echo 'export const answer: number = 1;' > src/a.ts
```

For each input, start `tsc --lsp --stdio` in `proj`. Send `initialize` (empty capabilities) and `initialized`, then
`textDocument/didOpen` for `src/a.ts`, then one of:

```jsonc
{ "method": "textDocument/hover", "params": { "textDocument": { "uri": "untitled" }, "position": { "line": 0, "character": 0 } } }
{ "method": "textDocument/didOpen", "params": { "textDocument": { "uri": "untitled", "languageId": "typescript", "version": 1, "text": "" } } }
{ "method": "workspace/didChangeWatchedFiles", "params": { "changes": [{ "uri": "untitled", "type": 2 }] } }
{ "method": "codeLens/resolve", "params": { "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 0 } } } }
// didClose then didChange of src/a.ts, back to back:
{ "method": "textDocument/didClose", "params": { "textDocument": { "uri": "file:///.../proj/src/a.ts" } } }
{ "method": "textDocument/didChange", "params": { "textDocument": { "uri": "file:///.../proj/src/a.ts", "version": 2 }, "contentChanges": [{ "text": "x" }] } }
```

For the startup cases, send `initialize` and then `textDocument/hover` on `src/a.ts` without `initialized`, or send
`initialize` with `"rootUri": "untitled"` and then `initialized`. `repro.mjs` has the full list of 13 inputs.

**Expected:** an error response for requests (InvalidParams for a bad URI or missing `data`, ServerNotInitialized
before `initialized`); a logged error for notifications; the server keeps running and answers the next request.

**Actual (7.1.0-dev.20261014.1):** the process exits with status 2. The script's output:

```
hover on a URI with no scheme: CRASH
    input:     textDocument/hover {uri: "untitled"}
    response:  no response (server exited)
    server:    exited with status 2; follow-up hover: not sent (server had exited)
    stderr:    panic: invalid URI: untitled [recovered, repanicked]
didChangeWatchedFiles with a URI with no scheme: CRASH
    input:     workspace/didChangeWatchedFiles {uri: "untitled", type: 2}
    server:    exited with status 2; follow-up hover: not sent (server had exited)
    stderr:    panic: invalid URI: untitled
didChange right after didClose: CRASH
    input:     didClose src/a.ts, then didChange src/a.ts (version 2); no further request
    server:    exited with status 2; follow-up hover: not sent (server had exited)
    stderr:    panic: should see no changes after close
codeLens/resolve without data: CRASH
    input:     codeLens/resolve {range}
    response:  no response (server exited)
    server:    exited with status 2; follow-up hover: not sent (server had exited)
    stderr:    panic: runtime error: invalid memory address or nil pointer dereference
hover before initialized: CRASH
    input:     initialize, then textDocument/hover on src/a.ts before the initialized notification
    response:  no response (server exited)
    server:    exited with status 2; follow-up hover: not sent (server had exited)
    stderr:    panic: runtime error: invalid memory address or nil pointer dereference
...
REPRODUCED: 11 of 13 bad inputs killed the server (...)
```

Stack for the hover on `untitled` (nightly, so line numbers are a little later than b85298b6):

```
panic: invalid URI: untitled [recovered, repanicked]
	internal/project/snapshot.go:447
	internal/lsp/lsproto/lsp.go:38
	internal/project/projectcollectionbuilder.go:648
	internal/project/snapshot.go:582
	internal/project/session.go:1389
	...
	internal/lsp/server.go:1384     (registerLanguageServiceDocumentRequestHandler, synchronous part)
	internal/lsp/server.go:1186     (handleRequestOrNotification)
	internal/lsp/server.go:1050     (dispatchLoop)
```

7.0.2 crashes on the same 11 inputs and on two more: a hover on `foo://bar` (`panic: invalid URI: foo://bar`), and
`completionItem/resolve` with `data.fileName: ""` (`panic: vfs: path "tsconfig.json" is not absolute`). The nightly
answers both with error -32603.

### Impact

One bad message from a client, an extension, or a proxy in front of the server takes down the whole server: every open
project, every pending request, and every later request. Editors restart it, but the user sees the server crash and
loses state. Non-`file:` documents that a client forwards by mistake (an `untitled` buffer, a URI with no scheme) are
the likely real-world trigger. The didClose/didChange order can happen with a buggy or racing client.

### Cause

Line numbers are at commit b85298b6 (2026-09-29), under `internal/`.

The common cause is that panics escape the synchronous part of a handler. `dispatchLoop` calls
`handleRequestOrNotification` directly (`lsp/server.go:1013`), with no `recover`. `Server.recover` is deferred only
inside the async closures (for example `lsp/server.go:1352`), and in `handleCompletionItemResolve` /
`handleCodeLensResolve` only after the language service is found. URI conversion and snapshot updates run before that,
on the dispatch goroutine. The `[recovered, repanicked]` in some messages comes from the logging `recover` in
`Snapshot.Clone` (`project/snapshot.go:446-449`), which re-panics.

- Bad URIs. `lsproto.DocumentUri.FileName` panics instead of returning an error: `invalid file URI` when
  `url.Parse` fails (`lsp/lsproto/lsp.go:26`), and `invalid URI` when there is no `:` (`:38`) or a `scheme://authority`
  has no `/` after it (`:45`). Callers on the synchronous path include `ProjectCollectionBuilder.DidRequestFile`
  (`project/projectcollectionbuilder.go:640`, hover and call hierarchy), the overlay update during `DidOpenFile`
  (`project/overlayfs.go:495`, flushed synchronously by `project/session.go:333`), `DidChangeWatchedFiles`
  (`project/session.go:444`), `GetEditsForFileRename` (`ls/file_rename.go:37`), and `handleInitialized`, for `rootUri`
  (`lsp/server.go:1718`). The nightly no longer panics on `foo://bar`, so the `:45` case looks fixed after b85298b6.
- didChange after didClose. `DidCloseFile` and `DidChangeFile` queue both changes (`project/session.go:363-372`,
  `:375`). When the debounced update processes them, `processChanges` panics with `should see no changes after close`
  (`project/overlayfs.go:461`). An overlay that is not open should make `didChange` an error that is logged and ignored.
- Requests before `initialized`. `s.session` is created in `handleInitialized` (`lsp/server.go:1728`). The plain
  request and notification wrappers check `s.session == nil` (`:1302`, `:1322`), but the language service wrappers do
  not. `registerLanguageServiceDocumentRequestHandler` calls `s.session.GetLanguageService` on a nil session
  (`:1347`), which dereferences it in `getSnapshot` (`project/session.go:1033`). The wrappers at `:1368` and `:1403`
  have the same gap (inferred from the source, not tested).
- `codeLens/resolve` without `data`. `handleCodeLensResolve` reads `codeLens.Data.Uri` without a nil check
  (`lsp/server.go:2217`).
- `completionItem/resolve` with an empty `data.fileName` (7.0.2 only). `handleCompletionItemResolve` passes the name
  to `lsconv.FileNameToDocumentURI` (`lsp/server.go:2121`) with no check. On the nightly the server rejects it with
  `completion item data fileName must be absolute`.

A fix could make `FileName` return an error, so handlers can answer InvalidParams. Another option is to add the
`s.session == nil` check to the language service wrappers. A `recover` around the synchronous handler call in
`dispatchLoop` would turn the remaining cases into InternalError responses, not crashes.
