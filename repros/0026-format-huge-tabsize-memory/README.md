# 0026: formatting with a huge tabSize allocates gigabytes

| | |
|-|-|
| Status | reproduces; not filed |
| Area | language server, `textDocument/formatting` (also range and on-type formatting) |
| Reproduces on | 7.0.2, 7.1.0-dev.20261014.1 |
| Does not reproduce on | none known |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Needs Node 22 (the LSP client is `lib/lsp-client.mjs`).

The script is safe to run on a laptop: `repro.mjs` samples the server's RSS every 200 ms with `ps` and SIGKILLs it as
soon as RSS passes 2 GB, or after 20 s. Each tabSize runs in a fresh server.

Found by the differential audit in maschwenk/tsrs PR #513 against tsgo b85298b6, which reported tsgo growing to 92 GB
with `tabSize: 1e9`. tsrs clamps indentation to 100 columns per level.

## Bug report draft (for microsoft/TypeScript)

Title: Formatting allocates tabSize × indentation depth spaces with no limit; tabSize 1e9 needs gigabytes per line

### Summary

The server takes `FormattingOptions.tabSize` from the request as is and builds each line's indentation with
`strings.Repeat(" ", columns)`. A client that sends a very large tabSize with `insertSpaces: true` makes the server
build a string of that many spaces for every indented line, multiplied by the nesting depth, and then serialize it into
the response. Memory grows linearly with tabSize × total indentation levels. With `tabSize: 1e9` (well inside the
protocol's `uinteger` range), a 3-line file pushes the server past 2 GB in about 1 to 2 seconds. A real file runs it out
of memory.

### Repro

```sh
mkdir -p proj/src && cd proj
echo '{ "compilerOptions": { "noEmit": true, "strict": true }, "include": ["src"] }' > tsconfig.json
printf 'function f() {\nreturn 1;\n}\n' > src/a.ts
```

Start `tsc --lsp --stdio`, open `src/a.ts`, and send `textDocument/formatting` with
`options: { tabSize: N, insertSpaces: true }` for N = 4, 1e6, 1e7, 1e9, one fresh server per value. (Use a memory limit
for the server, e.g. a watchdog. Without one, the 1e9 request can take several GB.)

**Expected:** the 1e9 request is answered quickly with a bounded indent, or tabSize is rejected or clamped. It should not
cost much more than the tabSize 4 request does.

**Actual (7.0.2):**

```
tabSize 4: answered in 4 ms, RSS 53 MB -> peak 55 MB, edits [1:0 insert 4 spaces]
tabSize 1000000: answered in 13 ms, RSS 52 MB -> peak 59 MB, edits [1:0 insert 1000000 spaces]
tabSize 10000000: answered in 890 ms, RSS 53 MB -> peak 104 MB, edits [1:0 insert 10000000 spaces]
tabSize 1000000000: killed by the watchdog: RSS 2185 MB passed 2048 MB after 1.2 s; RSS samples [0.2s 1186 MB, 0.4s 1847 MB, 0.6s 1965 MB, 0.8s 1965 MB, 1.0s 1965 MB, 1.2s 2185 MB]
REPRODUCED: tabSize 1000000000: RSS 2185 MB passed 2048 MB after 1.2 s and still rising (tabSize 4 answered in 4 ms at 55 MB)
```

7.1.0-dev.20261014.1 is the same: the 1e9 request passed 2048 MB after 2.2 s (2383 MB), and the smaller values returned
indents of exactly tabSize spaces.

Most of the 1e7 case's 890 ms is the test client reading the 10 MB response. The 1e7 case is there to show that the
indent equals tabSize; it is not a timing measurement.

How memory scales: in separate runs with a higher cap (6 GB) and a client that only counted response bytes, 7.0.2 peaked
at:

| tabSize | file | indentation columns | peak RSS | response |
|-|-|-|-|-|
| 1e8 | above (1 line, depth 1) | 1e8 | 534 MB | 100 MB |
| 1e8 | `function f() {` / `if (x) {` / `return 1;` / `}` / `}` (depths 1, 2, 1) | 4e8 | 1508 MB | 400 MB |
| 1e9 | above (1 line, depth 1) | 1e9 | 4825 MB | 1000 MB |

So peak memory is about 4 to 5 bytes per indentation column the server writes, with no cap. A 100-line file at an
average depth of 2 with `tabSize: 1e9` would need on the order of 10^12 bytes. The 92 GB in the tsrs audit fits this.
With `insertSpaces: false` the same tabSize gives one tab per level (`getIndentationString` divides by tabSize), so the
problem needs `insertSpaces: true`.

### Impact

A single formatting request with a bad tabSize makes the language server use memory until it is killed or the machine
runs out. The value can come from a misconfigured editor setting or a client bug; the server does not validate it. All
three formatting requests (document, range, on-type) go through the same options conversion.

### Cause

Line numbers are at commit b85298b6 (2026-09-29).

`internal/ls/lsutil/formatcodeoptions.go:94-97`, `FromLSFormatOptions`, copies the request's tabSize into both
`TabSize` and `IndentSize` with no bounds check:

```go
updatedSettings.TabSize = int(opt.TabSize)
updatedSettings.IndentSize = int(opt.TabSize)
```

It is called by all three handlers in `internal/ls/format.go` (lines 43, 161, 191).

`internal/format/span.go:998-1013`, `getIndentationString`, then builds the indentation for each line
(`insertIndentation` at :879 and `indentMultilineComment` at :988 call it):

```go
} else {
	return strings.Repeat(" ", indentation)   // :1013, indentation = depth × IndentSize
}
```

There is no limit on `indentation`, so each indented line costs `depth × tabSize` bytes, plus copies when the edit is
converted to `lsproto.TextEdit` and JSON-encoded. A fix could clamp tabSize and indentSize in `FromLSFormatOptions` (tsrs
uses 100 columns per level), or reject unreasonable values.
