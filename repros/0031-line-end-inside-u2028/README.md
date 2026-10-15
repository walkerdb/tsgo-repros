# 0031: a line that ends in U+2028 or U+2029 ends inside the line break's UTF-8 encoding

| | |
|-|-|
| Status | reproduces; not filed |
| Area | language server, folding ranges, JSDoc completions |
| Reproduces on | 7.0.2, 7.1.0-dev.20261014.1 |
| Does not reproduce on | none known |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Needs Node 22 (the LSP client is `lib/lsp-client.mjs`).
`repro.mjs` writes the source files, since U+2028 and U+2029 are awkward to write from bash.

## Bug report draft (for microsoft/TypeScript)

Title: Lines ending in U+2028 / U+2029 end two bytes into the line break: wrong `#region` folding and no JSDoc template

### Summary

The language service finds the end of a line by taking the next line's start and subtracting one byte. That is right
for `\n`, but U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR), which ECMAScript also treats as line
breaks, are three bytes in UTF-8, so the "line" keeps the first two bytes of the break. Two visible effects:

- A `// #region name` / `// #endregion` folding range ends two characters too late (past the end of the file here),
  and its `collapsedText` ends in two U+FFFD.
- `/**` at the end of a line gets JSDoc tag completions (`@abstract`, `@access`, ...) instead of the `/** */` JSDoc
  template that the same text with `\n` gets.

### Repro

`tsconfig.json`:

```json
{ "compilerOptions": { "noEmit": true, "strict": true }, "include": ["src"] }
```

Folding: three files with the same text, with `<BR>` being `\n`, U+2028 or U+2029:

```
// #region name<BR>const a = 1;<BR>// #endregion<BR>
```

Send `textDocument/foldingRange` (client capability `foldingRange.collapsedText: true`).

JSDoc: three files `/**<BR>function f(a: number) {}\n`; send `textDocument/completion` at 0:3, right after `/**`.

**Expected:** the U+2028 / U+2029 files get the same results as `\n`. LSP positions count only `\n`, `\r\n` and `\r` as
line breaks, so in those files the `#endregion` line is still line 0, and the region should end at 0:42, the end of
`// #endregion`, with collapsed text `name`. The completion should offer the `/** */` template.

**Actual** (7.0.2 and 7.1.0-dev.20261014.1, identical):

```
foldingRange, LF: ok, ends 2:13, collapsedText "name" (code points: U+006E U+0061 U+006D U+0065); expected ends 2:13, collapsedText "name"
foldingRange, U+2028: WRONG, ends 0:44, collapsedText "name��" (code points: U+006E U+0061 U+006D U+0065 U+FFFD U+FFFD); expected ends 0:42, collapsedText "name"
foldingRange, U+2029: WRONG, ends 0:44, collapsedText "name��" (code points: U+006E U+0061 U+006D U+0065 U+FFFD U+FFFD); expected ends 0:42, collapsedText "name"
completion after "/**", LF: ok, JSDoc template "/**\n * $0\n * @param a ${1}\n */"
completion after "/**", U+2028: WRONG, no JSDoc template; 84 items, 84 JSDoc tags (@abstract, @access, @alias, ...)
completion after "/**", U+2029: WRONG, no JSDoc template; 84 items, 84 JSDoc tags (@abstract, @access, @alias, ...)
REPRODUCED: 4 of 4 U+2028 / U+2029 cases differ from LF (folding range end and collapsed text, JSDoc template completion)
```

The U+2028 file is 43 UTF-16 code units long, so the folding range's end, 0:44, is past the end of the file.

### Impact

Small: U+2028 / U+2029 as line terminators are rare in source (they turn up in generated or pasted text). But the
server returns a range past the end of the document and a label with replacement characters, and the bad line end
is shared by every caller of `getLineEndOfPosition`.

### Cause

Line numbers are at commit b85298b6 (2026-09-29).

`getLineEndOfPosition` (`internal/ls/completions.go:3033-3047`) returns `lineStarts[line+1] - 1` (`:3040`), one
byte before the next line's start, and only adjusts for `\r\n`. `GetECMALineStarts` counts U+2028 / U+2029 as line
breaks, so for those lines the result is the offset of the break's third byte, and `text[lineStart:lineEnd]` holds
its first two bytes (`E2 80`).

- Folding (`internal/ls/folding.go`): `addRegionOutliningSpans` slices the line with that end (`:169-170`), so
  `parseRegionDelimiter`'s name keeps the two bytes (`strings.TrimSpace` at `:396` does not remove them), and they
  reach the client as two U+FFFD. The `#endregion` line's `lineEnd` is the range end (`:190`);
  `positionToLineAndCharacter` (`internal/ls/lsconv/converters.go:440`) ranges over `text[start:position]`, where
  each of the two stray bytes decodes as one U+FFFD, one UTF-16 unit each, hence two characters too far.
- JSDoc (`internal/ls/jsdoc_snippet.go`): `isPotentiallyValidJSDocSnippetCompletionPosition` (`:74-85`) and
  `getDocCommentEndAtPosition` (`:181-190`) take the text from the caret to `lineEnd` as the suffix after `/**`. With
  the two bytes in it the suffix is neither whitespace nor `*/` (`isJSDocSnippetSuffix`, `:525-539`), so the template
  is not offered and completion falls through to JSDoc tag names.

A fix is to end the line before the line break: step back over the whole break (`\n`, `\r\n`, `\r`, U+2028, U+2029)
rather than one byte.
