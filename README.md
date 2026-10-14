# tsgo-repros

Reproductions of bugs in [tsgo](https://github.com/microsoft/TypeScript), the Go port of the TypeScript compiler
(the `typescript` 7.x npm package). Each repro is a script that installs the tsgo version under test, builds the
smallest project that shows the bug, and reports whether the bug still happens, so it can be rerun against new
releases and nightlies.

## Repros

| ID | Bug | Reproduces on | Upstream |
|----|-----|---------------|----------|
| [0001](repros/0001-watch-misses-edits-through-symlinked-directories) | Watch misses edits to files under a symlinked directory | 7.0.2, 7.1.0-dev.20261013.1 | not filed |
| [0002](repros/0002-watch-misses-save-during-first-build) | Watch misses a save made during the first build | 7.0.2, 7.1.0-dev.20261013.1 | not filed |
| [0003](repros/0003-content-mapper-declaration-output-becomes-input) | A content-mapped file's declaration output becomes an input of the next build | 7.1.0-dev.20261013.1 | not filed |
| [0004](repros/0004-lsp-unanswered-configuration-request-blocks-server) | An unanswered workspace/configuration request blocks the language server | 7.0.2, 7.1.0-dev.20261013.1 | not filed |
| [0005](repros/0005-watch-compiles-half-written-save) | Watch compiles a save that is still being written | 7.0.2, 7.1.0-dev.20261013.1 | not filed |
| [0006](repros/0006-ts2590-depends-on-checker-count) | TS2590 is reported or not depending on `--checkers` | 7.0.2, 7.1.0-dev.20261013.1 | not filed |
| [0007](repros/0007-completion-results-vary-between-runs) | Auto-import completions come back in a different order on every request | 7.0.2, 7.1.0-dev.20261013.1 | not filed |
| [0008](repros/0008-check-ignores-sigint) | `tsc` keeps type checking after SIGINT or SIGTERM | 7.0.2, 7.1.0-dev.20261013.1 | not filed |
| [0009](repros/0009-rename-file-extra-companion-edits) | Renaming foo.d.css.ts to another declaration kind also renames foo.css | 7.0.2 | not filed |
| [0010](repros/0010-signature-help-nested-tagged-template) | Signature help in a tagged template or JSX element nested in a call shows the outer call | 7.0.2, 7.1.0-dev.20261013.1 | not filed |
| [0011](repros/0011-watch-own-outputs-start-a-rebuild) | `tsc --watch` starts a second build after every edit because of its own outputs | 7.0.2, 7.1.0-dev.20261013.1 | not filed |
| [0012](repros/0012-watch-new-directory-starts-a-rebuild) | Creating any directory in a watched directory starts a full build | 7.0.2, 7.1.0-dev.20261013.1 | not filed |
| [0013](repros/0013-lsp-exit-status-after-shutdown) | Language server exits with status 1 after a clean shutdown and exit | 7.0.2, 7.1.0-dev.20261013.1 | not filed |
| [0014](repros/0014-emit-partially-emitted-expression-unwind) | Nested type assertions reorder comments and source map ends in emit | 7.0.2, 7.1.0-dev.20261013.1 | not filed |
| [0015](repros/0015-trace-resolution-output-is-nondeterministic) | `--traceResolution` output differs from run to run | 7.0.2, 7.1.0-dev.20261013.1 | not filed |
| [0016](repros/0016-api-file-names-order-varies) | `--api` returns a config's fileNames in a random order after a snapshot update that adds a file | 7.1.0-dev.20261013.1 | not filed |
| [0017](repros/0017-api-completions-fail-needs-auto-imports) | `--api` completions fail with "completion list needs auto imports" | 7.0.2 (every scenario tried), 7.1.0-dev.20261013.1 (when the project is not the file's default project) | not filed |
| [0018](repros/0018-api-frame-size-allocated-before-read) | `--api` allocates a frame's declared size before reading it | 7.0.2, 7.1.0-dev.20261013.1 | not filed |
| [0019](repros/0019-api-unknown-callback-panics) | `--api` --callbacks with an unknown name crashes with a Go panic | 7.0.2, 7.1.0-dev.20261013.1 | not filed |
| [0020](repros/0020-build-watch-reloads-wildcards-every-cycle) | `tsc -b --watch` re-reads the include directory tree on every file event | 7.0.2 (both modes), 7.1.0-dev.20261013.1 (`tsc -b --watch`) | not filed |
| [0021](repros/0021-package-json-completions-order-varies) | package.json dependency completions come back in a random order | 7.0.2, 7.1.0-dev.20261013.1 | not filed |
| [0022](repros/0022-lsp-fsevents-drop-overflows-every-watched-root) | On macOS, a burst of writes under one watched directory overflows every watched directory | 7.0.2, 7.1.0-dev.20261014.1 | not filed |
| [0023](repros/0023-lsp-fsevents-watch-merges-into-distant-ancestor) | On macOS, crowded watches merge into a recursive watch on a distant ancestor | 7.0.2, 7.1.0-dev.20261014.1 | not filed |

## Running

Requirements: bash, npm, and whatever a repro lists (e.g. git). Tested on Linux; 0022 and 0023 need macOS (they print
"skipped" elsewhere).

```sh
./run-all.sh                                   # every repro, against the latest release
TSGO_VERSION=next ./run-all.sh                 # against the nightly
TSGO_VERSION=7.0.2 ./run-all.sh 0002           # one repro, one version
TSGO=/path/to/built/tsc ./run-all.sh           # against a local build
repros/0001-watch-rebuilds-on-non-source-files/repro.sh   # one repro, full output
```

Environment variables (see [lib/common.sh](lib/common.sh)):

- `TSGO_VERSION`: an npm version or dist-tag of `typescript`; default `latest`. Each version is installed once into
  `.cache/tsgo/<version>`.
- `TSGO`: a tsgo binary to use instead of installing one.
- `REPRO_KEEP=1`: keep the repro's work directory (under `.cache/`) for inspection.

Work directories live under `.cache/`, not `/tmp`: on some container `/tmp` file systems (overlayfs), watch mode
receives no file events at all, which hides watch bugs.

## Conventions

- Each repro is `repros/NNNN-short-slug/`, numbered in the order added; numbers are never reused.
- `repro.sh` exits 1 when the bug reproduces, 0 when it doesn't, and 2 or more when the script itself failed. It ends
  with one line starting `REPRODUCED:` or `NOT REPRODUCED:`.
- `README.md` holds the status table, how to run the repro, and the bug report, written so it can be pasted into an
  upstream issue.
- When an issue is filed, link it in the repro's README and in the table above. When a fix ships, record the first
  fixed version and keep the repro as a regression check.
- Shared helpers (installing tsgo, work directories, watch sessions) go in `lib/`.

## Adding a repro

```sh
cp -r template repros/NNNN-short-slug
```

Then fill in `repro.sh` and `README.md`, run it against the latest release and the nightly, and add a row to the table.
