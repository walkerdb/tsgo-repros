# 0009: renaming foo.d.css.ts to another declaration kind also renames foo.css

| | |
|-|-|
| Status | reproduces on 7.0.2; fixed in the nightly; not filed |
| Area | language server, `workspace/willRenameFiles` |
| Reproduces on | 7.0.2 |
| Does not reproduce on | 7.1.0-dev.20261013.1 |
| Upstream | not filed; already fixed on main (fix commit not identified) |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Needs Node 22 (the LSP client is `lib/lsp-client.mjs`). Kept as a
regression check. Filing is only useful if a 7.0.x fix is wanted.

## Bug report draft (for microsoft/TypeScript)

Title: willRenameFiles renames the companion foo.css when foo.d.css.ts is renamed to a .d.ts or another .d.*.ts

### Summary

When a `.d.css.ts` file is renamed, the server also returns a RenameFile for its companion `.css` file, so that
`foo.d.css.ts -> bar.d.css.ts` also renames `foo.css -> bar.css`. That is intended. But the server also returns that
companion RenameFile when the new name is a different declaration kind, such as `bar.d.ts` or `bar.d.scss.ts`. The
client then renames the stylesheet too, to a name nothing refers to.

### Repro

```sh
mkdir -p proj/src && cd proj
echo '{ "compilerOptions": { "noEmit": true, "strict": true, "module": "preserve", "allowArbitraryExtensions": true }, "include": ["src"] }' > tsconfig.json
echo '.a { color: red }' > src/styles.css
echo 'declare const styles: { a: string }; export default styles;' > src/styles.d.css.ts
echo 'import styles from "./styles.css"; console.log(styles.a);' > src/index.ts
```

Start `tsc --lsp --stdio`, initialize with `workspace.workspaceEdit.documentChanges: true`,
`resourceOperations: ["rename"]` and `workspace.fileOperations.willRename: true`, open `src/index.ts`, and send
`workspace/willRenameFiles` for `src/styles.d.css.ts` to each new name (one fresh session per name).

Expected: a RenameFile `src/styles.css -> src/theme.css` only for `theme.d.css.ts`.

Actual (7.0.2):

```
styles.d.css.ts -> theme.d.css.ts: RenameFile [src/styles.css -> src/theme.css]; text edits [src/index.ts: "./theme.css"]
styles.d.css.ts -> theme.d.ts: RenameFile [src/styles.css -> src/theme.css]; text edits [src/index.ts: "./theme"]  <- extra RenameFile
styles.d.css.ts -> theme.d.scss.ts: RenameFile [src/styles.css -> src/theme.css]; text edits [src/index.ts: "./theme.scss"]  <- extra RenameFile
```

7.1.0-dev.20261013.1 returns no RenameFile for the last two.

### Impact

Renaming a CSS module's declaration file in an editor that applies willRenameFiles edits would also
rename the `.css` file. In the `.d.scss.ts` case, the rewritten import (`./theme.scss`) and the renamed stylesheet
(`theme.css`) no longer match.

### Cause

Line numbers are at commit b85298b6 (2026-09-29), `internal/ls/file_rename.go`.

In `GetEditsForFileRename`, the companion check computes the new declaration extension from the old path:

```go
newDtsExt := tspath.GetDeclarationFileExtension(oldPath)   // :53, should be newPath
newOriginalExtensions := tspath.GetPossibleOriginalInputExtensionForExtension(newDtsExt)
if slices.Contains(newOriginalExtensions, ext) {           // :55, always true
```

So `newOriginalExtensions` equals the old file's original extensions, and the guard that should skip the companion
rename when the declaration kind changes never fires. The nightly no longer shows the extra RenameFile, so this looks
fixed on main after that commit.
