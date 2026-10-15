# 0030: go to definition on a `this` declared by JSDoc `@this` returns the start of the file

| | |
|-|-|
| Status | reproduces; not filed |
| Area | language server, go to definition, JS (`checkJs`) |
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

Title: Go to definition on `this` in a function with a JSDoc `@this` tag goes to the start of the file

### Summary

In a JS file, `/** @this {Foo} */ function f() { this.x }` gets a synthesized `this` parameter. Go to definition
(and source definition) on `this` in the body returns an empty range at line 0, character 0, the start of the file,
which is not where `this` is declared. With an explicit `this` parameter in a TS file, definition goes to the
parameter.

### Repro

`tsconfig.json`:

```json
{ "compilerOptions": { "noEmit": true, "strict": true, "allowJs": true, "checkJs": true }, "include": ["src"] }
```

`src/a.js`:

```js
// Line 0 is this comment, so a result here points at nothing.
class Foo {
	constructor() {
		this.x = 1;
	}
}

/** @this {Foo} */
function f() {
	return /*1*/this.x;
}
```

`src/b.ts` (control):

```ts
// Line 0 is this comment, so a result here points at nothing.
class Foo {
	x = 1;
}

function f(this: Foo) {
	return /*2*/this.x;
}
```

Send `textDocument/definition` and `custom/textDocument/sourceDefinition` on the `this` after each `/*N*/`.

**Expected:** at 1, the `@this` tag (line 7), or no result; at 2, the `this` parameter (5:11-5:15).

**Actual** (7.0.2 and 7.1.0-dev.20261014.1, identical):

```
/*1*/ src/a.js `this` at 9:13
  definition:       a.js 0:0-0:0 -> "" on line "// Line 0 is this comment, so a result here points at nothing."
  sourceDefinition: a.js 0:0-0:0 -> "" on line "// Line 0 is this comment, so a result here points at nothing."
  prepareRename:    {"range":{"start":{"line":9,"character":13},"end":{"line":9,"character":17}},"placeholder":"(Missing)"}
/*2*/ src/b.ts `this` at 6:13
  definition:       b.ts 5:11-5:15 -> "this" on line "function f(this: Foo) {"
  sourceDefinition: b.ts 5:11-5:15 -> "this" on line "function f(this: Foo) {"
  prepareRename:    {"range":{"start":{"line":6,"character":13},"end":{"line":6,"character":17}},"placeholder":"this"}
REPRODUCED: 2 of 2 requests (definition, sourceDefinition) on a JSDoc @this `this` return the empty range at 0:0, the start of the file; the TS this-parameter control points at the parameter
```

The same missing position shows in `textDocument/prepareRename`: its placeholder is `(Missing)`, the text of a
missing identifier, where the TS control gets `this`. (The repro prints it but does not count it in the verdict.)
Hover, type definition, references and document highlights on `this` are fine.

### Impact

Go to definition (F12, Ctrl+click) on `this` in JSDoc-typed JS jumps to the top of the file. `@this` is the only way
to type `this` in a JS function, so this hits JS projects that use `checkJs`.

### Cause

Line numbers are at commit b85298b6 (2026-09-29).

`internal/parser/reparser.go:491-506` (`case ast.KindJSDocThisTag`) inserts a `this` parameter whose name is
`p.factory.NewIdentifier("this")` (`:498`) and never gets a location: `p.finishReparsedNode(thisParam,
tag.TagName())` (`:506`) sets the parameter's `Loc` to the tag name's, not the identifier's, so the identifier keeps
pos -1, end -1. The `@callback` / `@typedef` signature path in the same file gives its synthesized `this` identifier
the tag's location (`:170-172`, `thisIdent.Loc = thisTag.Loc`).

Go to definition then takes the declaration's name (`internal/ls/definition.go:249`, `createRangeFromNode`).
`scanner.GetTokenPosOfNode` returns `node.Pos()` for a missing node (`internal/scanner/scanner.go:2528-2530`), so
the range is (-1, -1), and `positionToLineAndCharacter` clamps -1 to 0 (`internal/ls/lsconv/converters.go:421`),
which yields 0:0-0:0.

The same identifier also lands in the file's name table at position -1 (`internal/ast/ast.go:2870`), where -1
means "this name appears more than once" (`:2868`). The two readers (`completions.go:4036`, JS identifier completions,
and `findallreferences.go:2730`, a presence check) do not compare the value against -1, so we found no visible effect
of that.

A fix is to give the identifier a location, for example `tag.TagName().Loc` or the tag's, as `:171` does.
