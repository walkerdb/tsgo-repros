# 0034: JS API: factory update functions drop the original node's text range, so printing loses its comments

| | |
|-|-|
| Status | reproduces; not filed |
| Area | JS API SDK (`typescript/ast/factory`, `typescript/ast/visitor`), printer |
| Reproduces on | 7.0.2, 7.1.0-dev.20261021.1 |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Needs Node 22. See 0033 for how the script parses and prints on
7.0 and 7.1 (`lib/api-sdk.mjs`).

## Bug report draft (for microsoft/TypeScript)

Title: JS API factory `update*` functions return nodes with pos/end -1 instead of the original node's range

### Summary

In the JS API SDK, `updateTypeReferenceNode` and the other `update*` functions in `ast/factory` return a fresh
`create*` node with `pos` and `end` of -1 when a child changed. They do not copy the original node's text range, unlike
the Go factory (`updateNode` sets `updated.Loc = original.Loc`) and TypeScript 5's factory (`update()` calls
`setTextRange(updated, original)`). `visitEachChild` uses these functions, so every ancestor of a changed node loses its
position, and the printer drops the comments attached to it.

### Repro

```js
import { API } from "typescript/sync";
import { createIdentifier, updateSourceFile, updateTypeReferenceNode } from "typescript/ast/factory";
import { visitEachChild } from "typescript/ast/visitor";
import { isIdentifier } from "typescript/ast/is";

const api = new API();
const sf = api.createSourceFile("/b.ts",
	`export type B = {\n  x: Foo /* trailing */\n  y: Foo // eol\n  z: Bar /* kept */\n}\n`).sourceFile;
const rename = (n) => isIdentifier(n) && n.text === "Foo" ? createIdentifier("NFoo") : visitEachChild(n, rename);
const rebuilt = rename(sf.statements[0]);

const ref = sf.statements[0].type.members[0].type;            // Foo, 22..26
const updated = updateTypeReferenceNode(ref, createIdentifier("NFoo"), undefined);
console.log(ref.pos, ref.end, updated.pos, updated.end);      // 22 26 -1 -1
console.log(api.printer.printFile(updateSourceFile(sf, [rebuilt], sf.endOfFileToken)));
api.close();
```

The file has no comment at offset 0, so 0033 does not affect the output.

Text ranges before and after `visitEachChild` (7.0.2 and 7.1.0-dev.20261021.1):

```
type alias                         original 0..79    updated -1..-1
type literal                       original 15..79   updated -1..-1
x: Foo  (property signature)       original 17..26   updated -1..-1
Foo     (type reference)           original 22..26   updated -1..-1
z: Bar  (untouched sibling)        original 50..66   updated 50..66   (same node)
updateTypeReferenceNode(Foo, NFoo) original 22..26   updated -1..-1
```

TypeScript 5.9 keeps 22..26 for the updated type reference, and the same for its ancestors.

**Expected** (what TypeScript 5.9's printer prints for the same transform):

```ts
export type B = {
    x: NFoo; /* trailing */
    y: NFoo; // eol
    z: Bar; /* kept */
};
```

**Actual** (7.0.2 and 7.1.0-dev.20261021.1):

```ts
export type B = {
    x: NFoo;
    y: NFoo;
    z: Bar; /* kept */
};
```

The comments on the two rebuilt members are gone; the untouched `z` member keeps its comment.

### Impact

A source-to-source code generator written against the JS API cannot preserve comments: renaming one identifier deep in
a declaration drops the comments of every node between it and the root, including JSDoc and line comments on members.
Callers can work around it by copying `pos`/`end` from the original onto each new node their visitor returns, which
gives TypeScript 5's output above, but every user of `visitEachChild` has to know to do that.

### Cause

`src/ast/factory.generated.ts` (shipped as `dist/ast/factory.generated.js:5488` in 7.1.0-dev.20261021.1, `:2799` in
7.0.2):

```js
export function updateTypeReferenceNode(node, typeName, typeArguments) {
    return node.typeName !== typeName || node.typeArguments !== typeArguments ? createTypeReferenceNode(typeName, typeArguments) : node;
}
```

Every generated `update*` function has this shape. The Go factory these are generated to mirror copies the range and
flags from the original (`internal/ast/ast.go:103-112` at commit b85298b6):

```go
func updateNode(updated *Node, original *Node, hooks NodeFactoryHooks) *Node {
	if updated != original {
		updated.Flags = original.Flags
		updated.Loc = original.Loc
```

A fix is for the generator to wrap the `create*` call in an `updateNode(updated, original)` helper that copies `pos`,
`end` and `flags`, as Go and TypeScript 5 do.
