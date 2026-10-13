# 0010: signature help in a tagged template or JSX element nested in a call shows the outer call

| | |
|-|-|
| Status | reproduces; not filed |
| Area | language server, signature help |
| Reproduces on | 7.0.2, 7.1.0-dev.20261013.1 |
| Does not reproduce on | none known |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed. Needs Node 22 (the LSP client is `lib/lsp-client.mjs`).

## Bug report draft (for microsoft/TypeScript)

Title: Signature help inside a tagged template or JSX element that is a call argument shows the outer call's signature

### Summary

When the caret is inside a tagged template's substitution, or inside a JSX opening element's attributes, and that
template or element is an argument of another call, signature help shows the outer call's signature instead of the
tag's or component's. The same positions outside a call, and an ordinary call nested in a call, work.

### Repro

`tsconfig.json`:

```json
{ "compilerOptions": { "noEmit": true, "strict": true, "jsx": "preserve" }, "include": ["src"] }
```

`src/tagged.ts`:

```ts
export {};
declare function outer(a: any, b: number): void;
declare function tag(strings: TemplateStringsArray, x: number): string;
declare function inner(x: number): string;
outer(tag`a ${/*1*/} b`, 1);
tag`a ${/*2*/} b`;
outer(inner(/*3*/), 1);
```

`src/jsx.tsx`:

```tsx
export {};
declare global { namespace JSX { interface Element {} interface IntrinsicElements {} } }
declare function outer(a: any, b: number): void;
declare function Comp(props: { x: number }): JSX.Element;
outer(<Comp /*4*/ />, 1);
const e = <Comp /*5*/ />;
```

Send `textDocument/signatureHelp` (`triggerKind: 1`, invoked) at each `/*N*/`.

Expected: at 1 and 2, `tag(strings: TemplateStringsArray, x: number): string`; at 3, `inner(x: number): string`; at 4
and 5, `Comp(props: { x: number; }): JSX.Element`.

Actual (7.0.2 and 7.1.0-dev.20261013.1):

```
/*1*/ tagged template inside a call: WRONG, shows "outer(a: any, b: number): void", expected tag(...)
/*2*/ tagged template, not nested: ok, shows "tag(strings: TemplateStringsArray, x: number): string", expected tag(...)
/*3*/ call inside a call: ok, shows "inner(x: number): string", expected inner(...)
/*4*/ JSX element inside a call: WRONG, shows "outer(a: any, b: number): void", expected Comp(...)
/*5*/ JSX element, not nested: ok, shows "Comp(props: { x: number; }): JSX.Element", expected Comp(...)
```

### Impact

Wrong parameter hints in common code: styled-components or `html`/`css` tagged templates passed to a function, and JSX
passed as an argument (`render(<App foo={...} />, root)`, `expect(<X />)`, `React.memo`-style wrappers).

### Cause

Line numbers are at commit b85298b6 (2026-09-29), `internal/ls/signaturehelp.go`.

Two places build `argumentsSpan` with a length where `core.NewTextRange(pos, end)` expects an end, likely left over
from the TypeScript 5.x `createTextSpan(start, length)`:

- `:1002` (JSX opening-like element): `core.NewTextRange(attributeSpanStart, attributeSpanEnd-attributeSpanStart)`
- `:1438` (`getApplicableRangeForTaggedTemplate`): `core.NewTextRange(applicableSpanStart, applicableSpanEnd-applicableSpanStart)`

`getContainingArgumentInfo` (`:861`) walks from the innermost invocation outward and returns the first one whose
`argumentsSpan` contains the caret (`:885-893`). For the tag or JSX element, the range's end is a length, which is
less than its start unless the element is near the top of the file, so it never contains the caret. The walk moves on
to `outer(...)`, whose span is right. Without an enclosing call, the walk falls back to the innermost invocation, which
is why cases 2 and 5 work. The other `NewTextRange` calls in the file pass an end. The fix is to pass
`attributeSpanEnd` and `applicableSpanEnd` directly.
