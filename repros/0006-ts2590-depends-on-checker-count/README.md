# 0006: TS2590 is reported or not depending on --checkers

| | |
|-|-|
| Status | reproduces; not filed |
| Area | checker, parallel type checking |
| Reproduces on | 7.0.2, 7.1.0-dev.20261013.1, 7.1.0-beta, 7.1.0-dev.20261023.1 (all tested) |
| Does not reproduce on | not known |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. The script runs `--checkers 1, 2, 3, 4, 8`, three times each,
and reproduces when the outputs differ. For a fixed checker count the output was the same in every run.

## Bug report draft (for microsoft/TypeScript)

Title: TS2590 "union type that is too complex" is reported or not depending on `--checkers`

### Summary

On the same project, `tsc` prints a TS2590 error with some `--checkers` values and nothing with others. A checker
reports TS2590 only the first time it evaluates the too-complex type. Which files share a checker depends on the
checker count, so the diagnostics do too.

### Repro

`map.ts` (K0, K1 and K2 are each a union of 50 object types; only the first members are shown):

```ts
export type K0 = { k0_0: 0 } | { k0_1: 1 } | /* ... */ { k0_49: 49 }
export type K1 = { k1_0: 0 } | { k1_1: 1 } | /* ... */ { k1_49: 49 }
export type K2 = { k2_0: 0 } | { k2_1: 1 } | /* ... */ { k2_49: 49 }
export type ModelMap = { k0: K0; k1: K1; k2: K2 }
export type Key = keyof ModelMap
export interface GetModel {
	<T extends Key>(key: T): ModelMap[T] | undefined
}
```

`x/a.ts`:

```ts
import type { GetModel, Key, ModelMap } from "../map"
declare function lookup(key: Key): ModelMap[Key] | undefined
// @ts-ignore
export const getA: GetModel = key => lookup(key)
type Build<N extends number, A extends unknown[] = []> = A["length"] extends N ? A : Build<N, [...A, A["length"]]>
export type Slow = Build<0>
```

`x/zz.ts`:

```ts
import type { GetModel, Key, ModelMap } from "../map"
declare function lookup(key: Key): ModelMap[Key] | undefined
import { getA } from "./a"
export const again = getA
export const getB: GetModel = key => lookup(key)
```

`tsconfig.json`:

```json
{
	"compilerOptions": { "strict": true, "noEmit": true, "target": "es2022", "module": "esnext", "moduleResolution": "bundler", "types": [] },
	"files": ["map.ts", "x/a.ts", "x/zz.ts"]
}
```

```sh
tsc -p . --pretty false --checkers 1
tsc -p . --pretty false --checkers 3
```

Expected: the same diagnostics for every `--checkers` value.

Actual (7.1.0-dev.20261013.1):

```
--checkers 1: (no output)
--checkers 2: (no output)
--checkers 3: x/zz.ts(5,14): error TS2590: Expression produces a union type that is too complex to represent.
--checkers 4: x/zz.ts(5,14): error TS2590: Expression produces a union type that is too complex to represent.
--checkers 8: x/zz.ts(5,14): error TS2590: Expression produces a union type that is too complex to represent.
```

7.0.2 prints nothing at `--checkers 1` and the error at 2, 3, 4 and 8. `--singleThreaded` prints nothing on both
versions, and so does TypeScript 5.9.3.

### Impact

A project can pass type checking on one machine and fail on another, or fail only in CI, because the default checker
count follows the number of CPUs. Raising or lowering `--checkers` to speed up a build can add or remove errors.

### Cause

Inferred from the source at commit b85298b6 (line numbers at that commit), not confirmed with a debugger.

The write constraint of `ModelMap[T]`, needed when the arrow function is related to the generic `GetModel`
signature, is `K0 & K1 & K2`: a cross product of 125,000 constituents. `checkCrossProductUnion` reports TS2590 at
`c.currentNode` when the size reaches 100,000 and `getIntersectionTypeEx` returns the error type
(`internal/checker/checker.go:27118-27128`). The result is then cached under the intersection's key
(`c.intersectionTypes[key] = result`, `checker.go:26690`), and results built from it are cached too (relation
cache, instantiation caches). A later evaluation of the same type on the same checker hits the cache and reports
nothing.

`x/a.ts` evaluates the type first, under `// @ts-ignore`. When `x/a.ts` and `x/zz.ts` are checked by the same
checker, `x/zz.ts` gets the cached error type and no TS2590. When they are on different checkers, the checker for
`x/zz.ts` evaluates the type itself and reports it. The file-to-checker assignment depends on the checker count
(`internal/compiler/checkerpool.go`), so the output does too.
