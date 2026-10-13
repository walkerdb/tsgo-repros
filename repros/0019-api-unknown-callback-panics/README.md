# 0019: --api --callbacks with an unknown name crashes with a Go panic

| | |
|-|-|
| Status | reproduces; not filed |
| Area | `tsc --api` command line |
| Reproduces on | 7.0.2, 7.1.0-dev.20261013.1 (both tested) |
| Does not reproduce on | not known |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. The script starts `tsc --api` with a misspelled callback name
and with a list that has a space after the comma, and checks whether stderr starts with `panic:`.

## Bug report draft (for microsoft/TypeScript)

Title: `tsc --api --callbacks` with an unknown name prints a Go panic and stack trace

### Summary

An unknown entry in `--callbacks` (a typo, or a space after a comma) makes `tsc --api` panic with a stack trace
instead of printing a usage error.

### Repro

```sh
tsc --api --callbacks readFile,fileExsts < /dev/null
tsc --api --callbacks "readFile, fileExists" < /dev/null
```

Expected: an error message such as `unknown callback name "fileExsts"; valid names are readFile, fileExists, ...`, and
exit status 1 or 2 without a stack trace. Leading and trailing spaces around names could also be trimmed.

Actual (7.1.0-dev.20261013.1, exit status 2):

```
panic: unknown callback name: fileExsts

goroutine 1 [running]:
github.com/microsoft/TypeScript/tsc/internal/api.newCallbackFS({0x1bf6808, 0x1c34370}, {0x3454013c3e00, 0x2, 0x3454012fe000?}, 0x345401468930)
	github.com/microsoft/TypeScript/tsc/internal/api/callbackfs.go:85 +0x87a
github.com/microsoft/TypeScript/tsc/internal/api.(*StdioServer).Run(0x345401471d00, {0x1bf4988, 0x345401468b40})
```

With `"readFile, fileExists"` the message is `panic: unknown callback name:  fileExists` (note the leading space).
7.0.2 panics the same way, from `internal/api/callbackfs.go:57`.

### Impact

Small: the API client in the `typescript` package passes valid names. People starting the server by hand or from
another language see a crash dump for a typo.

### Cause

From the source at commit b85298b6 (line numbers at that commit).

`runAPI` splits the flag on `,` without trimming (`cmd/tsc/api.go:55`). `StdioServer.Run` calls `newCallbackFS`
(`internal/api/server.go:84`), which does `panic("unknown callback name: " + name)` for an unknown name
(`internal/api/callbackfs.go:76` and `:85`). Validating the list in `parseAPIFlags` and returning an error would give a
normal message.
