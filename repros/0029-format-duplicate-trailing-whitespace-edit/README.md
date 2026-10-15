# 0029: range and on-type formatting return the same trailing-whitespace delete twice

| | |
|-|-|
| Status | reproduces; not filed |
| Area | language server, `textDocument/rangeFormatting`, `textDocument/onTypeFormatting` |
| Reproduces on | 7.0.2, 7.1.0-dev.20261014.1 |
| Does not reproduce on | none known |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Needs Node 22 (the LSP client is `lib/lsp-client.mjs`).

Found by the differential audit in maschwenk/tsrs PR #513 against tsgo b85298b6, which reported that range and on-type
formatting return the same trailing-whitespace delete twice. The PR says TypeScript 5.x does the same; that was not
checked here.

## Bug report draft (for microsoft/TypeScript)

Title: Range and on-type formatting return duplicate trailing-whitespace deletes when the range ends in comments

### Summary

When a formatting range ends inside the leading comments of a token that is past the range, the server can trim the
same line's trailing whitespace twice and return two identical TextEdits. The LSP spec says the edits of one response
must not overlap. The tsrs audit reports that clients reject such a response; a client that applies the edits one after
another deletes text that is not whitespace. Document formatting of the same file returns the delete once.

### Repro

```sh
mkdir -p proj/src && cd proj
echo '{ "compilerOptions": { "noEmit": true, "strict": true }, "include": ["src"] }' > tsconfig.json
printf '// one\n  \n// two\nlet x = 1;\n' > src/a.ts   # line 1 is two spaces
```

Start `tsc --lsp --stdio`, open `src/a.ts`, and send, with `options: { tabSize: 4, insertSpaces: true,
trimTrailingWhitespace: true }`:

- `textDocument/formatting` (control)
- `textDocument/rangeFormatting` for 1:0-2:6 (the blank line and `// two`)
- `textDocument/onTypeFormatting` with `ch: "\n"` at 2:0, as after pressing Enter just before `// two`

The result is the same without `trimTrailingWhitespace`.

**Expected:** each response deletes line 1's two spaces once: `1:0-1:2 ""`.

**Actual (7.0.2):**

```
formatting: 1 edits [1:0-1:2 ""]
rangeFormatting 1:0-2:6: 2 edits [1:0-1:2 ""; 1:0-1:2 ""]  <- overlapping: 1:0-1:2 "" / 1:0-1:2 ""
onTypeFormatting "\n" at 2:0: 2 edits [1:0-1:2 ""; 1:0-1:2 ""]  <- overlapping: 1:0-1:2 "" / 1:0-1:2 ""
REPRODUCED: 2 of 2 requests returned overlapping edits (rangeFormatting 1:0-2:6, onTypeFormatting "\n" at 2:0); document formatting returns the delete once
```

7.1.0-dev.20261014.1 prints the same.

The same flaw also edits lines before the range. In the same file, `rangeFormatting` for 2:0-2:6 (only `// two`)
returns `1:0-1:2 ""`, which deletes whitespace on line 1, outside the requested range. `repro.sh` does not check this.

### Impact

Format Selection over such a range, and format-on-type after pressing Enter between comments when the line above holds
only whitespace, return an invalid response. Depending on the client, the formatting is rejected or the second delete
removes the next characters. A blank line with trailing whitespace between two comments is common in real code. (Client
behavior was not tested here; the repro checks only the server response.)

### Cause

Line numbers are at commit b85298b6 (2026-09-29), `internal/format/span.go`.

Range formatting (`FormatSelection`, `api.go:115`) and Enter (`FormatOnEnter`, `api.go:152`) both call `FormatSpan`.
With the range above, no token starts in the range, so `execute` handles the range's comments as the remaining leading
trivia of `let` (:262-279). That trivia list holds every leading comment of `let`, including `// one`, which is before
the range.

1. `indentTriviaItems` sends `// two` (inside the range) to `processRange`. `previousRange` is still empty, so
   `processRange` trims every line from the range's first line up to the comment's line (:766-769). That is the first
   `1:0-1:2` delete. `previousRange` is now `// two`.
2. `trimTrailingWhitespacesForRemainingRange` (:796) starts after `previousRange` (:799), the end of `// two`. It then
   walks the whole trivia list from the start, and at each comment it sets `startPos = trivia.Loc.End() + 1` (:808). At
   `// one`, that moves `startPos` back to the start of line 1. At `// two`, `startPos < trivia.Loc.Pos()`, so it trims
   lines 1 through 1 again (:804-805). That is the second, identical delete.

```go
for _, trivia := range trivias {
	if isComment(trivia.Kind) {
		if startPos < trivia.Loc.Pos() {                                   // :804
			w.trimTrailingWitespacesForPositions(startPos, trivia.Loc.Pos()-1, w.previousRange)
		}
		startPos = trivia.Loc.End() + 1                                    // :808, can move startPos backwards
	}
}
```

`startPos` should only move forward, for example `startPos = max(startPos, trivia.Loc.End()+1)`. Comments that end
before the current `startPos` should be skipped. The same backward move also explains the out-of-range edit above: it
trims lines between a comment before the range and the first comment in it.
