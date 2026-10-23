#!/usr/bin/env bash
# Without a package.json in the project, the language server asks the client to watch all of /Users (macOS).
source "$(dirname "$0")/../../lib/common.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"
# Linux already excludes /home/<name>, so only macOS can show the bug; 7.0.2 does not reproduce on Linux.
[[ "$(uname -s)" == Darwin ]] || skip "needs macOS (/Users)"

tsgo_install
make_workdir

# The climb only reaches the home directory's parent when the work directory is under $HOME.
case "$(pwd -P)/" in
	"$(cd "$HOME" && pwd -P)"/*) ;;
	*) die "the repo must be under \$HOME for this repro (work directory: $(pwd -P))" ;;
esac

out="$(TSGO="$TSGO" node "$HERE/repro.mjs" "$(pwd -P)")" || die "LSP client failed: $out"
echo "$out" | sed '$d'
read -r _ reproduced summary <<<"$(echo "$out" | tail -1)"
[[ "$reproduced" == 2 ]] && die "$summary"
verdict "$reproduced" "$summary"
