# 0001: `--watch` rebuilds when a non-source file changes under an included directory

| | |
|-|-|
| Status | reproduces; not filed |
| Area | `tsc --watch` |
| Reproduces on | 7.0.2, 7.1.0-dev.20261013.1 |
| Does not reproduce on | 5.9.3 (JS `tsc`) |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed.

## Bug report draft (for microsoft/TypeScript)

**Title:** `tsc --watch` rebuilds when any file changes under an included directory, even files that can't be in the program

### Summary

With `"include": ["src"]`, `tsc --watch` starts a full incremental cycle ("File change detected. Starting incremental
compilation...") whenever any file under `src/` changes, whatever its name or extension: `src/notes.txt`, a `.swp`
file, or the `4913` probe file vim creates and deletes on every `:w`. TypeScript 5.9 ignores these changes.

### Repro

```
tsconfig.json   { "compilerOptions": { "noEmit": true, "strict": true }, "include": ["src"] }
src/a.ts        export const a: number = 1;
```

1. `tsc -p . --watch --preserveWatchOutput`
2. `echo x >> other/notes.txt` (outside `include`) three times: no rebuild.
3. `echo x >> src/notes.txt` three times.
4. `touch src/sub/4913; rm src/sub/4913` three times (`src/sub` existed before the watch started).

**Expected:** no rebuilds in steps 3 and 4. The files don't match any supported extension, so they can't affect the program.

**Actual:** `repro.sh` output, 7.0.2 and 7.1.0-dev.20261013.1 (Linux):

```
rebuilds for 3 writes to other/notes.txt (outside include): 0
rebuilds for 3 writes to src/notes.txt:                     3
rebuilds for 3 create+delete of src/sub/4913:              5
```

### Impact

Each spurious cycle costs a full incremental build's program update and diagnostics pass. On
[microsoft/vscode](https://github.com/microsoft/vscode) (`tsc -p src --watch`, 7.0.2), each append to
`src/vs/notes.txt` started a cycle that took about 1–2 s and reprinted every diagnostic. Editors that write swap,
backup, or probe files next to the file being saved cause one or more of these per save, in addition to the real one.

### Cause

`Watcher.isRelevantChange` (`tsc/internal/execute/watcher.go:391`, at b85298b6) treats a changed path as relevant if
`PossiblyMatchesDirectoryName(p)` holds:

```go
if w.config.ConfigFile != nil && w.config.PossiblyMatchesDirectoryName(p) {
	return true
}
```

`PossiblyMatchesDirectoryName` (`tsc/internal/tsoptions/parsedcommandline.go:433`) is true for every path under a
recursive wildcard directory, so this check accepts any file under `src/`, not only directories. The language server's
equivalent check (`tsc/internal/project/configfileregistrybuilder.go:611`) also requires `DirectoryExists(fileName)`.
A similar guard here (or a check on directory deletion that doesn't need the path to exist) would leave
`PossiblyMatchesFileName`, which already checks extensions, to decide for files.
