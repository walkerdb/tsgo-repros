# 0033: JS API: printing a file that contains a factory-built node prints the comments at offset 0 around it

| | |
|-|-|
| Status | reproduces; not filed |
| Area | JS API SDK (`typescript/sync`, `typescript/ast/factory`), AST encoder, printer |
| Reproduces on | 7.0.2, 7.1.0-dev.20261021.1 |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Needs Node 22. The SDK helpers are in `lib/api-sdk.mjs`: on 7.1
the script uses `api.createSourceFile` and `api.printer.printFile`; 7.0 has neither, so it opens the file in a project
and uses `project.emitter.printNode` (the SDK exports are under `typescript/unstable/*` in 7.0).

## Bug report draft (for microsoft/TypeScript)

Title: JS API encoder sends synthesized nodes with pos/end 0, so the printer emits the file's first comment around them

### Summary

The JS API SDK's node encoder replaces a negative `pos` or `end` with 0 before sending a node to the server. A node
built with the `ast/factory` functions has `pos` and `end` of -1, so the server's printer receives it as a real node
located at offset 0 and prints the comments that start at offset 0 of the source file next to it. A file that starts
with a header or license comment gets that comment copied into the middle of the printed code.

### Repro

```js
import { API } from "typescript/sync";
import { createIdentifier, updateSourceFile } from "typescript/ast/factory";
import { visitEachChild } from "typescript/ast/visitor";
import { isIdentifier } from "typescript/ast/is";

const api = new API();
const sf = api.createSourceFile("/a.ts",
	`/* HEADER */\nimport { Foo } from "./foo"\nexport type A = Foo | { x: Foo }\n`).sourceFile;
const rename = (n) => isIdentifier(n) && n.text === "Foo" ? createIdentifier("NFoo") : visitEachChild(n, rename);
const rebuilt = rename(sf.statements[1]);
console.log(api.printer.printFile(updateSourceFile(sf, [rebuilt], sf.endOfFileToken)));
console.log(api.printer.printFile(updateSourceFile(sf, [sf.statements[0], rebuilt], sf.endOfFileToken)));
api.close();
```

**Expected** (what TypeScript 5.9's printer prints for the same transform with `ts.factory` and `ts.visitEachChild`):

```ts
export type A = NFoo | {
    x: NFoo;
};
```

and, with the import kept, the header once, before the import:

```ts
/* HEADER */
import { Foo } from "./foo";
export type A = NFoo | {
    x: NFoo;
};
```

**Actual** (7.0.2 and 7.1.0-dev.20261021.1 print the same):

```ts
export type A = /* HEADER */ NFoo | /* HEADER */ {
    x: NFoo;
};
/* HEADER */
```

```ts
/* HEADER */
import { Foo } from "./foo";
export type A = /* HEADER */ NFoo | /* HEADER */ {
    x: NFoo;
};
/* HEADER */
```

### Impact

The JS API is the way to write a source-to-source code generator against TypeScript 7: parse a file, rewrite some nodes
with the factory and `visitEachChild`, print the result. Any file whose first token is preceded by a comment (license
headers, `// @ts-nocheck`, `/** @jsx ... */` pragmas) gets that comment duplicated next to factory-built nodes and at
the end of the file. The output is wrong, and the only
workaround is to strip offset-0 comments from the output or avoid factory nodes, which defeats the transform.

### Cause

The node encoder in the SDK, `src/api/node/encoder.ts` (shipped as `dist/api/node/encoder.js:177`, `:196` and `:231`
in 7.1.0-dev.20261021.1), clamps negative positions for nodes, node lists, and the root node:

```js
nodeValues.push(node.kind, node.pos >= 0 ? node.pos : 0, node.end >= 0 ? node.end : 0, ...
nodeValues.push(KIND_NODE_LIST, list.pos >= 0 ? list.pos : 0, list.end >= 0 ? list.end : 0, ...
```

The Go side cannot tell a synthesized node from a real one at offset 0. The printer skips comments only for synthesized
positions (`ast.PositionIsSynthesized`, `pos < 0`), and `emitList` prints the comments at each child's position and
after the last child's end (`internal/printer/printer.go:4979-4982` and `:5014-5022` at commit b85298b6), so every
clamped node pulls in the comments at offset 0. `updateSourceFile` also builds its statements `NodeArray` with
`pos`/`end` -1, so the list end is clamped to 0 too, which is where the copy at the end of the file comes from.

A fix needs a wire value for "no position". The positions are written as `uint32`, and the Go decoder converts them with
`int(pos)` (`internal/api/encoder/decoder.go:165` and `:174`), so the encoder could send `0xFFFFFFFF` and the decoder
could map it to -1. As an experiment, changing only the encoder to send `0xFFFFFFFF` makes both cases print the
expected output, but only because 4294967295 is past the end of the file; the decoder change is needed for the printer
to treat the node as synthesized.

Related: 0034 (factory `update*` functions drop the original node's text range), which is why the rebuilt union and
type literal above are also synthesized.
