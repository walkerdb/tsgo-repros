# 0028: moving a file and its import together returns two conflicting edits for the import

| | |
|-|-|
| Status | reproduces; not filed |
| Area | language server, `workspace/willRenameFiles` |
| Reproduces on | 7.0.2, 7.1.0-dev.20261014.1, 7.1.0-beta, 7.1.0-dev.20261023.1 |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Needs Node 22 (the LSP client is `lib/lsp-client.mjs`).

Found by the differential audit in maschwenk/tsrs PR #513.

## Bug report draft (for microsoft/TypeScript)

Title: willRenameFiles with several files returns overlapping, wrong edits when an importer and its import move together

### Summary

When one `workspace/willRenameFiles` request moves both a file and a file it imports, the response has two edits for the
same import specifier, with different text. Each edit accounts for only one of the two moves, so neither is correct.
In the simplest case, moving both files into the same folder, the import needs no edit at all.

### Repro

```sh
mkdir -p proj/src && cd proj
echo '{ "compilerOptions": { "noEmit": true, "strict": true, "module": "nodenext" }, "include": ["src"] }' > tsconfig.json
echo 'export const b = 1;' > src/b.ts
echo 'import { b } from "./b.js"; console.log(b);' > src/a.ts
```

Start `tsc --lsp --stdio`, initialize with `workspace.workspaceEdit.documentChanges: true`,
`resourceOperations: ["rename"]` and `workspace.fileOperations.willRename: true`, open `src/a.ts`, and send one
`workspace/willRenameFiles` request with two files: `src/a.ts -> src/moved/a.ts` and `src/b.ts -> src/moved/b.ts`. This
is the request an editor sends when both files are selected and dragged into `src/moved/` together.

Expected: no edits. `./b.js` is still the right specifier after both files move.

Actual (7.0.2; 7.1.0-dev.20261014.1 gives the same edits):

```
src/a.ts:1:20-1:26: "./b.js" -> "../b.js"  <- overlaps another edit
src/a.ts:1:20-1:26: "./b.js" -> "./moved/b.js"  <- overlaps another edit
```

The two edits are in two separate `TextDocumentEdit`s for `src/a.ts`. The first is the edit for moving `a.ts` alone; the
second is the edit for moving `b.ts` alone.

### Impact

The LSP spec does not allow overlapping text edits in one workspace edit. A client may reject the whole edit, apply one
of the two, or apply both and corrupt the specifier. Whichever single edit it applies, the import is broken after the
move (`src/moved/a.ts` would import `src/b.js` or `src/moved/moved/b.js`). Moving a file together with something it imports
is a common refactor, and moving a group of related files into a new folder hits it for every import inside the group.

### Cause

Line numbers are at commit b85298b6 (2026-09-29).

`handleWillRenameFilesWorker` in `internal/lsp/server.go` calls `GetEditsForFileRename` once per renamed file and
concatenates the results (`:1992-2025`):

```go
for _, languageService := range services {
	for _, file := range params.Files {
		changes := languageService.GetEditsForFileRename(ctx, file.OldUri, file.NewUri)
```

Each call builds a path updater for just its own rename (`internal/ls/file_rename.go:39`, `createPathUpdater` at
`:89-110`). In the first call `b.ts` is not moved, so the import is rewritten for the importer's move only; in the second
`a.ts` is not moved, so it is rewritten for the target's move only. The merge loop drops a later edit only when it has
the same range and the same text (`server.go:2006-2010`), so two edits with the same range and different text both go
into the response.

A fix: compute all renames in a request with one path updater that maps every old path (`oldToNew` over the whole
`params.Files` list), and run the import update once. The `updated`/`importingSourceFileMoved` logic in
`getUpdatedImportSpecifier` (`file_rename.go:288-305`) then sees both moves and keeps `./b.js`.
