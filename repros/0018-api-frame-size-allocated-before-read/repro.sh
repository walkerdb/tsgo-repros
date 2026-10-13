#!/usr/bin/env bash
# --api allocates a frame's declared payload size before reading it: one header reserves gigabytes or crashes the server.
source "$(dirname "$0")/../../lib/common.sh"
command -v node >/dev/null || die "node is required"
[[ -r /proc/self/status ]] || die "needs /proc (Linux) to read the server's memory"
here="$(cd "$(dirname "$0")" && pwd)"

tsgo_install
make_workdir

run() { node "$here/client.mjs" "$TSGO" "$1" "$2"; }
field() { node -e 'const o = JSON.parse(process.argv[1]); const v = process.argv[2].split(".").reduce((a, k) => a?.[k], o); console.log(v ?? "")' "$1" "$2"; }

reproduced=0 summary=()

# 1. msgpack, bin32 payload of 4 GiB - 1 declared, no payload sent.
out="$(run msgpack 4294967295)"; log "$out"
grow_mb=$(( ($(field "$out" after.vmSizeKB) - $(field "$out" before.vmSizeKB)) / 1024 ))
rss_mb=$(( $(field "$out" after.rssKB) / 1024 ))
summary+=("msgpack 4 GiB frame: virtual size +${grow_mb} MB, RSS ${rss_mb} MB;")
(( grow_mb >= 4000 )) && reproduced=1

# 2. JSON-RPC (--async), Content-Length of 1 TiB, no payload sent.
out="$(run jsonrpc 1099511627776)"; log "$out"
grow_gb=$(( ($(field "$out" after.vmSizeKB) - $(field "$out" before.vmSizeKB)) / 1024 / 1024 ))
rss_mb=$(( ($(field "$out" after.rssKB) - $(field "$out" before.rssKB)) / 1024 ))
summary+=("JSON-RPC 1 TiB header: virtual size +${grow_gb} GB, RSS +${rss_mb} MB;")
(( rss_mb >= 500 )) && reproduced=1

# 3 and 4. JSON-RPC, 128 TiB and 2^62: the server dies.
for size in 140737488355328 4611686018427387904; do
	out="$(run jsonrpc "$size")"; log "$out"
	status="$(field "$out" status)" err="$(field "$out" stderr)"
	summary+=("JSON-RPC $size header: exit $status ($(cut -d'|' -f1 <<<"$err" | sed 's/ *$//'));")
	[[ "$err" == *"out of memory"* || "$err" == *"makeslice"* ]] && reproduced=1
done

verdict "$reproduced" "${summary[*]}"
