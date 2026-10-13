#!/usr/bin/env bash
# TS2590 ("union type that is too complex") is reported or not depending on --checkers.
source "$(dirname "$0")/../../lib/common.sh"

tsgo_install
make_workdir

# K0, K1, K2: unions of 50 object types each. ModelMap[T]'s write constraint is K0 & K1 & K2, a cross product of
# 125,000 constituents, over the 100,000 limit.
{
	for k in 0 1 2; do
		printf 'export type K%s =' "$k"
		for i in $(seq 0 49); do
			(( i > 0 )) && printf ' |'
			printf ' { k%s_%s: %s }' "$k" "$i" "$i"
		done
		printf '\n'
	done
	cat <<'TS'
export type ModelMap = { k0: K0; k1: K1; k2: K2 }
export type Key = keyof ModelMap
export interface GetModel {
	<T extends Key>(key: T): ModelMap[T] | undefined
}
TS
} >map.ts
mkdir x
cat >x/a.ts <<'TS'
import type { GetModel, Key, ModelMap } from "../map"
declare function lookup(key: Key): ModelMap[Key] | undefined
// @ts-ignore
export const getA: GetModel = key => lookup(key)
type Build<N extends number, A extends unknown[] = []> = A["length"] extends N ? A : Build<N, [...A, A["length"]]>
export type Slow = Build<0>
TS
cat >x/zz.ts <<'TS'
import type { GetModel, Key, ModelMap } from "../map"
declare function lookup(key: Key): ModelMap[Key] | undefined
import { getA } from "./a"
export const again = getA
export const getB: GetModel = key => lookup(key)
TS
cat >tsconfig.json <<'JSON'
{
	"compilerOptions": { "strict": true, "noEmit": true, "target": "es2022", "module": "esnext", "moduleResolution": "bundler", "types": [] },
	"files": ["map.ts", "x/a.ts", "x/zz.ts"]
}
JSON

# Each checker count is run 3 times to show that, for a fixed count, the output is stable.
declare -A outputs
for checkers in 1 2 3 4 8; do
	for run in 1 2 3; do
		out="$("$TSGO" -p . --pretty false --checkers "$checkers" || true)"
		outputs["$checkers.$run"]="$out"
	done
	if [[ "${outputs[$checkers.1]}" != "${outputs[$checkers.2]}" || "${outputs[$checkers.1]}" != "${outputs[$checkers.3]}" ]]; then
		log "--checkers $checkers: output varies between runs"
	fi
	log "--checkers $checkers: $(printf '%s' "${outputs[$checkers.1]}" | grep -c TS2590 || true) TS2590 ${outputs[$checkers.1]:+(${outputs[$checkers.1]})}"
done

with=() without=()
for checkers in 1 2 3 4 8; do
	if grep -q TS2590 <<<"${outputs[$checkers.1]}"; then with+=("$checkers"); else without+=("$checkers"); fi
done
distinct="$(for k in "${!outputs[@]}"; do printf '%s\0' "${outputs[$k]}"; done | sort -zu | tr -cd '\0' | wc -c)"

reproduced=0
(( distinct > 1 )) && reproduced=1
verdict "$reproduced" "$distinct distinct outputs over --checkers 1,2,3,4,8 (3 runs each); TS2590 at --checkers ${with[*]:-none}, none at --checkers ${without[*]:-none}"
