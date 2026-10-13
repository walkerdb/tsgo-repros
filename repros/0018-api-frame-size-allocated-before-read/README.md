# 0018: --api allocates a frame's declared size before reading it

| | |
|-|-|
| Status | reproduces; not filed |
| Area | `tsc --api` transport (msgpack and `--async` JSON-RPC framing) |
| Reproduces on | 7.0.2, 7.1.0-dev.20261013.1 (both tested) |
| Does not reproduce on | not known |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Linux only (reads `/proc/<pid>/status`); requires node.
`client.mjs` starts the server, writes only the header of one frame that declares a large payload, waits 1.5 s, reads
the server's VmSize and VmRSS, and closes stdin.

## Bug report draft (for microsoft/TypeScript)

Title: API server allocates the declared message size up front; one header can use gigabytes or crash it

### Summary

Both API transports read a length from the frame header and allocate a buffer of that size before reading any of the
payload, with no upper limit. A msgpack frame declaring a 4 GiB payload reserves 4 GiB. A JSON-RPC (`--api --async`)
`Content-Length` of 1 TiB makes the server use 1.2 GB of resident memory before a single payload byte arrives, and a
larger value crashes it with a Go runtime error.

### Repro

msgpack (`tsc --api`): send `93 01 c4 04 "echo" c6 ff ff ff ff` (a request whose payload is a bin32 of 4294967295
bytes) and no payload. JSON-RPC (`tsc --api --async`): send `Content-Length: <n>\r\n\r\n` and no payload.

```sh
printf 'Content-Length: 4611686018427387904\r\n\r\n' | tsc --api --async
printf 'Content-Length: 140737488355328\r\n\r\n' | tsc --api --async
```

Expected: the server rejects a frame larger than some sane limit (or reads it incrementally) and reports an error,
without reserving the declared size first.

Actual (7.1.0-dev.20261013.1; 7.0.2 gives the same numbers within a few MB):

```
msgpack 4 GiB frame: virtual size +4102 MB, RSS 18 MB
JSON-RPC 1 TiB header: virtual size +1025 GB, RSS +1190 MB
JSON-RPC 140737488355328 header: exit 2 (runtime: out of memory: cannot allocate 140737488355328-byte block (7831552 in use))
JSON-RPC 4611686018427387904 header: exit 2 (panic: runtime error: makeslice: len out of range)
```

The last one prints a Go panic with a stack trace:

```
panic: runtime error: makeslice: len out of range

goroutine 1 [running]:
github.com/microsoft/TypeScript/tsc/internal/jsonrpc.(*Reader).Read(0xea5e5182010)
	github.com/microsoft/TypeScript/tsc/internal/jsonrpc/baseproto.go:70 +0x3cd
```

The language server uses the same JSON-RPC reader: `printf 'Content-Length: 4611686018427387904\r\n\r\n' | tsc --lsp
--stdio` crashes with the same panic on both versions (observed; not part of the script).

### Impact

A client bug, a corrupted stream, or a peer on a shared pipe or socket (`--pipe`) can make the server reserve and
partly commit huge amounts of memory, or kill it, with one header. Under strict memory overcommit settings or
container limits, even the 4 GiB msgpack case can fail. A crash takes down every snapshot and program held by the
session.

### Cause

From the source at commit b85298b6 (line numbers at that commit).

- msgpack: `readBin` reads a bin8/bin16/bin32 length and does `payload := make([]byte, size)` before
  `io.ReadFull` (`internal/api/protocol_msgpack.go:146-180`, allocation at `:176`). The bin32 length allows up to
  4 GiB - 1.
- JSON-RPC: `Reader.Read` parses `Content-Length` as an int64, rejects only negative values, and does
  `data := make([]byte, contentLength)` before `io.ReadFull` (`internal/jsonrpc/baseproto.go:33-76`, allocation at
  `:70`). A length above the address space limit makes `make` throw a fatal out-of-memory error or panic.

Reading into a growing buffer (for example `io.ReadAll(io.LimitReader(r, size))`) and rejecting sizes over a limit
would avoid both.
