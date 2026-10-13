#!/usr/bin/env bash
# Signature help inside a tagged template or JSX element that is an argument of another call shows the outer call.
source "$(dirname "$0")/../../lib/common.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"

tsgo_install
make_workdir

cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "noEmit": true, "strict": true, "jsx": "preserve" }, "include": ["src"] }
JSON
mkdir src
# Each /*N*/ marks a caret position. 1 and 4 are the nested cases; 2, 3 and 5 are controls.
cat >src/tagged.ts <<'TS'
export {};
declare function outer(a: any, b: number): void;
declare function tag(strings: TemplateStringsArray, x: number): string;
declare function inner(x: number): string;
outer(tag`a ${/*1*/} b`, 1);
tag`a ${/*2*/} b`;
outer(inner(/*3*/), 1);
TS
cat >src/jsx.tsx <<'TS'
export {};
declare global { namespace JSX { interface Element {} interface IntrinsicElements {} } }
declare function outer(a: any, b: number): void;
declare function Comp(props: { x: number }): JSX.Element;
outer(<Comp /*4*/ />, 1);
const e = <Comp /*5*/ />;
TS

out="$(TSGO="$TSGO" node "$HERE/repro.mjs" "$WORKDIR")" || die "LSP client failed: $out"
echo "$out" | sed '$d'
read -r _ reproduced summary <<<"$(echo "$out" | tail -1)"
[[ "$reproduced" == 2 ]] && die "$summary"
verdict "$reproduced" "$summary"
