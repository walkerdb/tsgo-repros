# tsgo-repros

Reproductions of bugs in [tsgo](https://github.com/microsoft/TypeScript), the Go port of the TypeScript compiler
(the `typescript` 7.x npm package). Each repro is a script that installs the tsgo version under test, builds the
smallest project that shows the bug, and reports whether the bug still happens, so it can be rerun against new
releases and nightlies.

## Repros

| ID | Bug | Reproduces on | Upstream |
|----|-----|---------------|----------|

## Running

Requirements: bash, npm, and whatever a repro lists (e.g. git). Tested on Linux.

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
