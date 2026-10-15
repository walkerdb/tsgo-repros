# 0032: with the UTF-8 position encoding, an edit inside a multi-byte character splits it

| | |
|-|-|
| Status | reproduces; not filed |
| Area | language server, position encoding, `textDocument/didChange` |
| Reproduces on | 7.0.2, 7.1.0-dev.20261014.1 |
| Does not reproduce on | none known |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Needs Node 22 (the LSP client is `lib/lsp-client.mjs`).

## Bug report draft (for microsoft/TypeScript)

Title: With `positionEncoding: "utf-8"`, a position inside a multi-byte character is used as is and an edit there
leaves invalid UTF-8 in the document

### Summary

When the client negotiates the UTF-8 position encoding, the server turns a `character` into a byte offset by adding
it to the line start, without checking that the offset is on a character boundary. An incremental `didChange` whose
range starts inside a multi-byte character splits it, and the server's copy of the document then holds invalid
UTF-8: `"é"` with `x` inserted at its second byte becomes `"\xC3x\xA9"`, which hover shows as `�x�`.

With the default UTF-16 encoding, the server handles the matching case, an offset between the two halves of a
surrogate pair, by snapping back to the start of the character. UTF-8 offsets get no such treatment.

### Repro

`tsconfig.json`:

```json
{ "compilerOptions": { "noEmit": true, "strict": true }, "include": ["src"] }
```

Initialize with `capabilities.general.positionEncodings: ["utf-8"]` (the server answers `positionEncoding:
"utf-8"`), then for each file below: `didOpen`, one incremental `didChange` inserting `"x"` (empty range) at the
given position, and `textDocument/hover` on `s`.

| File text | Edit at | Note |
|-|-|-|
| `export const s = "é";` | 0:19 | between é's bytes C3 and A9 |
| `/** é */` + `\n` + `export const s = 1;` | 0:5 | between é's bytes, in a JSDoc comment |
| `export const s = "é";` | 0:18 | control: before é |

And with a second server initialized with `positionEncodings: ["utf-16"]`: `export const s = "😀";`, edit at 0:19,
between the surrogates of 😀 (control).

**Expected:** a position inside a character resolves to a character boundary (the start of the character, as the
UTF-16 path does), so the first two cases give `xé`, like the control, and the document stays valid UTF-8. Rejecting
the change would also be reasonable. The LSP spec does not define positions inside a character for either encoding.

**Actual** (7.0.2 and 7.1.0-dev.20261014.1, identical):

```
client offers positionEncodings ["utf-8"]; server chose "utf-8"
  utf-8, string literal, offset 0:19 (between é's bytes): hover on s WRONG: "const s: \"\\uFFFDx\\uFFFD\""; expected it to contain "const s: \"xé\""
  utf-8, JSDoc comment, offset 0:5 (between é's bytes): hover on s WRONG: "const s: 1�x�" (non-ASCII: U+FFFD U+FFFD); expected it to contain "xé"
  utf-8, string literal, offset 0:18 (before é): hover on s ok: "const s: \"xé\"" (non-ASCII: U+E9); expected it to contain "const s: \"xé\""
client offers positionEncodings ["utf-16"]; server chose "utf-16"
  utf-16, string literal, offset 0:19 (between 😀's surrogates): hover on s ok: "const s: \"x😀\"" (non-ASCII: U+1F600); expected it to contain "const s: \"x😀\""
REPRODUCED: 2 of 2 UTF-8 edits inside é split it (hover shows U+FFFD in place of each half); the UTF-8 control and the UTF-16 offset between surrogates are right
```

In the string-literal case the literal type is printed with an escaped `�` for each stray byte. In the
JSDoc case the comment text reaches the client as is, and the JSON encoder replaces each invalid byte with a real
U+FFFD, which shows the overlay holds the two halves of é as separate bytes. (Plaintext hover puts the documentation
right after the signature with no separator, valid text included; that is unrelated.)

### Impact

A UTF-8 client should not send such positions, but one with an off-by-one in its own byte counting, or a stale
position after a concurrent edit, silently corrupts the server's copy of the document: diagnostics, hover, and edits
the server computes from then on are based on text the user does not have, and nothing reports an error. The same
unchecked conversion applies to every request position, not only `didChange`.

### Cause

Line numbers are at commit b85298b6 (2026-09-29).

`lineAndCharacterToPosition` (`internal/ls/lsconv/converters.go:366-415`) returns `start + char`, clamped to the
line, for the UTF-8 encoding (`:392-393`), with no check that the result is on a character boundary. The UTF-16
branch below it scans the line rune by rune and stops before a character that would pass `char` (`:407`), so an
offset between surrogates lands at the start of the character.

`didChange` uses this conversion: `overlayFS.processChanges` maps the change's range with `converters.FromLSPRange`
(`internal/project/overlayfs.go:548`) and applies the text at those byte offsets (`:551`), which splits é.

A fix is to snap the UTF-8 result back to the start of the character (`for pos > start &&
!utf8.RuneStart(text[pos]) { pos-- }`), matching the UTF-16 behavior.
