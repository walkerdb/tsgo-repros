# NNNN: one-line title

| | |
|-|-|
| Status | reproduces; not filed |
| Area | e.g. `tsc --watch`, `tsc -b`, checker, language server |
| Reproduces on | versions |
| Does not reproduce on | versions, if known |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed.

## Bug report draft (for microsoft/TypeScript)

**Title:**

### Summary

### Repro

**Expected:**

**Actual:**

### Impact

### Cause

Point at the Go source (path, line, and commit) if known.
