# 0027: renaming a file rewrites unresolved relative imports in files that do not import it

| | |
|-|-|
| Status | reproduces; not filed |
| Area | language server, `workspace/willRenameFiles` |
| Reproduces on | 7.0.2, 7.1.0-dev.20261014.1 |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Needs Node 22 (the LSP client is `lib/lsp-client.mjs`).

Found by the differential audit in maschwenk/tsrs PR #513, where renaming any file edited
`node_modules/@anthropic-ai/sdk/internal/types.d.mts`.

## Bug report draft (for microsoft/TypeScript)

Title: willRenameFiles rewrites unresolved relative imports in files unrelated to the rename

### Summary

For every relative import that does not resolve, `workspace/willRenameFiles` recomputes the specifier from its
normalized absolute path, even when neither the importing file nor the import's target moved. If the specifier is not
already in normal form, the response rewrites it. Two common shapes:

- a specifier with `..` in the middle, such as `./nested/../missing.js`, becomes `./missing.js`;
- a specifier that climbs above the file system root becomes one with exactly as many `../` as the file's depth.

This happens in every file in the program, including declaration files under `node_modules`.

### Repro

```sh
mkdir -p proj/src proj/node_modules/pkg/internal && cd proj
climb="$(printf '../%.0s' $(seq 40))nope"
echo '{ "compilerOptions": { "noEmit": true, "strict": true, "module": "nodenext" }, "include": ["src"] }' > tsconfig.json
echo '{ "name": "pkg", "version": "1.0.0", "types": "./index.d.ts" }' > node_modules/pkg/package.json
echo 'export * from "./internal/types.js";' > node_modules/pkg/index.d.ts
echo "export type { Missing } from \"$climb\"; export type T = number;" > node_modules/pkg/internal/types.d.ts
echo 'export const old = 1;' > src/old.ts
echo 'import { old } from "./old.js"; console.log(old);' > src/index.ts
cat > src/consumer.ts <<TS
import type { T } from "pkg";
import { a } from "./missing.js";
import { b } from "./nested/../missing.js";
import { c } from "$climb";
export const v: T = 1; console.log(a, b, c);
TS
```

Start `tsc --lsp --stdio`, initialize with `workspace.workspaceEdit.documentChanges: true`,
`resourceOperations: ["rename"]` and `workspace.fileOperations.willRename: true`, open `src/index.ts` and
`src/consumer.ts`, and send `workspace/willRenameFiles` for `src/old.ts -> src/new.ts`.

Expected: one edit, `./old.js -> ./new.js` in `src/index.ts`. Nothing else imports `src/old.ts`, and no other file moved.

Actual (7.0.2; 7.1.0-dev.20261014.1 gives the same edits):

```
node_modules/pkg/internal/types.d.ts:1:31: "../../../../../../...../../../../nope (124 chars)" -> "../../../../../../../../../nope"  <- unrelated
src/consumer.ts:3:20: "./nested/../missing.js" -> "./missing.js"  <- unrelated
src/consumer.ts:4:20: "../../../../../../...../../../../nope (124 chars)" -> "../../../../../../../nope"  <- unrelated
src/index.ts:1:22: "./old.js" -> "./new.js"
```

The number of `../` in the rewritten specifiers is the depth of the work directory, so it differs from machine to
machine. The plain `./missing.js` is not edited, but only because the recomputed text happens to equal the original.

### Impact

An editor that applies willRenameFiles edits changes files the user did not touch, on every rename. It edits files under
`node_modules`, which the user does not own and which a package manager will overwrite. The new specifiers depend on
where the project sits on disk. Because the edits come back on every rename, a user who reverts them gets them again on
the next rename.

### Cause

Line numbers are at commit b85298b6 (2026-09-29), `internal/ls/file_rename.go`.

`updateImportsForFileRename` visits every import in every source file of the program (`:230`, `:248`). For an import
that resolves, `getUpdatedImportSpecifier` returns early when neither the importer nor the target moved (`:288-291`).
For an import that does not resolve there is no such check: after the moved-files fallback finds no match, it falls
through to a plain path update (`:281-284`):

```go
// Fall back to a regular path update for unresolved module.
if tspath.IsExternalModuleNameRelative(importLiteral.Text()) {
	return l.updateRelativePath(oldToNew, sourceFile.FileName(), newImportFromPath, importLiteral.Text())
}
```

`updateRelativePath` (`:208-215`) normalizes the specifier to an absolute path, maps it through `oldToNew` (no match, so
it is kept), and rebuilds a relative specifier from it. Normalizing removes inner `..` segments and clamps a path that
climbs above the root, so the rebuilt text differs from the original, and `:250` emits the edit. `ReferencedFiles`
(`/// <reference path>`) go through the same `updateRelativePath` at `:238-246` with no moved check either, so they
should have the same problem (not tested here).

A fix: only rewrite an unresolved relative specifier when the importing file moved or `oldToNew` matched its absolute
path, and otherwise return `""`.
