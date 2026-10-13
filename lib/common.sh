# Shared helpers for repro scripts. Source it from a repro's repro.sh:
#
#   source "$(dirname "$0")/../../lib/common.sh"
#
# Environment:
#   TSGO_VERSION  npm version of `typescript` (tsgo) to test, or an npm dist-tag such as `next` (the nightly);
#                 default: latest.
#   TSGO          path to a tsgo binary to use instead of installing one (e.g. a local build).
#   REPRO_KEEP=1  keep the work directory after the run.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="$REPO_ROOT/.cache"

log() { printf '[%s] %s\n' "$(date +%T)" "$*" >&2; }
die() { log "error: $*"; exit 2; }

# Installs the requested tsgo into .cache/tsgo/<version> once and sets TSGO to its native binary.
tsgo_install() {
	if [[ -n "${TSGO:-}" ]]; then
		[[ -x "$TSGO" ]] || die "TSGO=$TSGO is not executable"
		return
	fi
	command -v npm >/dev/null || die "npm is required to install tsgo"
	local version
	version="$(npm view "typescript@${TSGO_VERSION:-latest}" version | tail -1 | awk '{print $NF}' | tr -d "'")"
	[[ -n "$version" ]] || die "no typescript version matches ${TSGO_VERSION:-latest}"
	local dir="$CACHE_DIR/tsgo/$version"
	if [[ ! -d "$dir/node_modules" ]]; then
		log "installing typescript@$version into $dir"
		mkdir -p "$dir"
		(cd "$dir" && npm init -y >/dev/null && npm install --no-audit --no-fund --silent "typescript@$version")
	fi
	# The npm package's bin is a Node launcher; use the platform package's native binary directly.
	TSGO="$(find "$dir/node_modules/@typescript" -path '*/lib/tsc' -type f -perm -u+x | head -1)"
	[[ -n "$TSGO" ]] || die "no native tsgo binary found under $dir/node_modules/@typescript"
	log "tsgo: $("$TSGO" --version) ($TSGO)"
}

# Creates a fresh work directory (removed on exit unless REPRO_KEEP=1) and cds into it. It lives under the repo, not
# /tmp: some container /tmp file systems (overlayfs) do not deliver the file events watch mode relies on.
make_workdir() {
	WORKDIR="$(mktemp -d "$CACHE_DIR/work.XXXXXX")"
	if [[ "${REPRO_KEEP:-}" != 1 ]]; then
		trap 'watch_stop; rm -rf "$WORKDIR"' EXIT
	else
		trap 'watch_stop; log "kept $WORKDIR"' EXIT
	fi
	cd "$WORKDIR"
}
mkdir -p "$CACHE_DIR"

# Starts `tsgo <args> --watch --preserveWatchOutput` in the background, logging to $WATCH_LOG, and waits for the
# first build to finish.
watch_start() {
	WATCH_LOG="$WORKDIR/watch.log"
	"$TSGO" "$@" --watch --preserveWatchOutput --pretty false >"$WATCH_LOG" 2>&1 &
	WATCH_PID=$!
	local i
	for i in $(seq 600); do
		grep -q 'Watching for file changes' "$WATCH_LOG" && return
		kill -0 "$WATCH_PID" 2>/dev/null || { cat "$WATCH_LOG" >&2; die "tsgo exited"; }
		sleep 0.1
	done
	die "the first build did not finish in 60 s"
}

watch_stop() {
	if [[ -n "${WATCH_PID:-}" ]]; then
		kill "$WATCH_PID" 2>/dev/null || true
		wait "$WATCH_PID" 2>/dev/null || true
		WATCH_PID=
	fi
}

# Number of incremental cycles the watch has started so far.
watch_cycles() { grep -c 'File change detected' "$WATCH_LOG" || true; }

# Waits until the watch log has not changed for $1 seconds (default 3).
watch_settle() {
	local quiet="${1:-3}" last size
	last="$(stat -c %s "$WATCH_LOG")"
	local still=0
	while (( still < quiet * 10 )); do
		sleep 0.1
		size="$(stat -c %s "$WATCH_LOG")"
		if [[ "$size" == "$last" ]]; then still=$((still + 1)); else still=0; last="$size"; fi
	done
}

# Ends the run: prints the verdict and exits 1 when the bug reproduced, 0 when it did not.
verdict() {
	local reproduced="$1" summary="$2"
	if [[ "$reproduced" == 1 ]]; then
		echo "REPRODUCED: $summary"
		exit 1
	fi
	echo "NOT REPRODUCED: $summary"
	exit 0
}
