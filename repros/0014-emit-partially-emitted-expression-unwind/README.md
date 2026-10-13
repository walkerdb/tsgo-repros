# 0014: nested type assertions reorder comments and source map ends in emit

| | |
|-|-|
| Status | reproduces; not filed |
| Area | emit (printer), comments, source maps |
| Reproduces on | 7.0.2, 7.1.0-dev.20261013.1 (both tested) |
| Does not reproduce on | TypeScript 5.9.3 and 6.0.3 (JS compiler, used as the reference) |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. The expected `k.js` and the expected source map position are
the output of TypeScript 5.9.3 (`tsc -p .` with the same tsconfig), hard-coded in the script. 6.0.3 prints the same
`k.js`.

## Bug report draft (for microsoft/TypeScript)

Title: Emit puts comments out of order and moves source map ends for nested type assertions

### Summary

When type assertions are nested (an `as` expression inside parentheses inside another `as`), the emitter writes the
comment that follows the inner assertion after the comment that follows the outer parentheses, so the output
comments are not in source order. The source map end of the inner parenthesized expression also maps to the end of
the outer parentheses. TypeScript 5.9 and 6.0 emit both in source order.

### Repro

`tsconfig.json`:

```json
{ "compilerOptions": { "target": "es2022", "module": "esnext", "sourceMap": true, "outDir": "out" }, "files": ["k.ts", "q.ts"] }
```

`k.ts`:

```ts
declare const x: unknown;
export function k() {
	return (
		(x) as any
		// k4
	) /*t*/ as string;
}
```

`q.ts`:

```ts
declare const x: unknown;
export const q = (
	(x) as any
	// q1
) as string;
```

```sh
tsc -p .
```

Expected (`out/k.js` from TypeScript 5.9.3 and 6.0.3):

```js
export function k() {
    return (x)
    // k4
    /*t*/;
}
```

Actual (`out/k.js` from 7.0.2 and 7.1.0-dev.20261013.1):

```js
export function k() {
    return (x) /*t*/
    // k4
    ;
}
```

In `out/q.js` (`export const q = (x)`), the position after the emitted `(x)` (line 1, column 20) maps to `q.ts` line 3,
column 11 (the end of `(x) as any`) in 5.9.3, and to line 5, column 1 (the end of the outer parentheses, after
`// q1`) in 7.x. Lines are 1-based, columns 0-based.

### Impact

Comments move relative to each other in the JS output, which matters for tools that read comments (license headers,
`/* @__PURE__ */`, coverage or lint directives) and for readers of the output. Debuggers and error reporters that use
the source map point at the wrong source range. The output also differs from TypeScript 5.x/6.x for the same input.

### Cause

From the source at commit b85298b6 (line numbers at that commit). The link between this code and the output above is
inferred from reading it; I did not trace it in a debugger.

The type eraser turns each assertion and each parenthesized assertion into a `PartiallyEmittedExpression`
(`internal/transformers/tstransforms/typeeraser.go:263-279`), so `((x) as any) as string` becomes three nested
`PartiallyEmittedExpression`s. `emitPartiallyEmittedExpression` (`internal/printer/printer.go:3023-3055`) pushes them on
a stack and then unwinds it:

```go
for stack.Len() > 0 {
	entry := stack.Pop()
	emitFlags := p.emitContext.EmitFlags(node.AsNode())
	if emitFlags&EFNoTrailingComments == 0 && node.End() != node.Expression.End() {
		p.emitLeadingCommentsOfPosition(node.Expression.End())
	}
	p.exitNode(node.AsNode(), entry.state)
	node = entry.node
}
```

`node` is updated at the end of the iteration, so from the second pop on, the comment check and `exitNode` use the
node one level further in than `entry`. Each level's "comments after my expression" are therefore written one pop
late, after the next outer level's `exitNode` has already written that level's trailing comments and source map end.
In `k.ts`, `// k4` (after `(x) as any`) is written after `/*t*/` (after the outer parentheses). In `q.ts`, the outer
parentheses' end mapping is added at the same output position as the inner one, before `// q1` is written, and
replaces it. Using `entry.node` instead of `node` in the loop body would likely match the TypeScript 5.x printer, which emits
each level's comments in its own call.
