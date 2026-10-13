#!/usr/bin/env bash
# `tsc -b --watch` re-reads every directory under the include directories (the wildcard file name expansion) on every
# cycle, even when the edit is to a file already in the program.
source "$(dirname "$0")/../../lib/common.sh"

tsgo_install
make_workdir

# The signal is each directory's access time: reading a directory's entries sets its atime when the atime is older
# than 24 hours (relatime, the Linux default), so after setting every atime to 2000-01-01 just before an edit, the
# directories whose atime changed are exactly the ones read since. Setting atime is not an event the watch reacts to (inotify IN_ATTRIB is not
# in tsgo's mask). The file system must record access times (not mounted noatime).
DIRS=200

# The project sits one level below the work directory, and has a package.json and `types: []`, so that tsgo's lookup
# watches stop at the project and file events from other work directories under .cache cannot start cycles.
mkdir -p proj/src
cd proj
echo '{}' >package.json
cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "noEmit": true, "strict": true, "types": [] }, "include": ["src"] }
JSON
echo 'export const a: number = 0;' >src/a.ts
dirs=(src)
for i in $(seq "$DIRS"); do
	mkdir "src/d$i"
	echo "notes" >"src/d$i/README.md"
	dirs+=("src/d$i")
done

RESET=2000-01-01
RESET_EPOCH="$(date -d "$RESET" +%s)"

# Sets the access time of every project directory to $RESET.
reset_atimes() { touch -a -d "$RESET" "${dirs[@]}"; }

# Prints how many of the project's directories were read since reset_atimes.
dirs_read() {
	stat -c %X "${dirs[@]}" | awk -v t="$RESET_EPOCH" '$1 != t' | wc -l
}

# Sanity check that this file system updates atime on directory reads.
reset_atimes
ls src >/dev/null
(( $(dirs_read) == 1 )) || die "this file system does not update directory access times; the repro needs it"

reproduced=0
summary=""
for mode in watch build; do
	if [[ "$mode" == watch ]]; then args=(-p .); label='tsc --watch'; else args=(-b .); label='tsc -b --watch'; fi
	watch_start "${args[@]}"
	watch_settle 2
	results=()
	for i in 1 2 3; do
		before="$(watch_cycles)"
		reset_atimes
		echo "export const a: number = $i;" >src/a.ts
		watch_settle 2
		cycles=$(( $(watch_cycles) - before ))
		read=$(dirs_read)
		log "$label: edit $i: $cycles cycles, $read of ${#dirs[@]} directories read"
		results+=("$read")
	done
	# A write to a file no project uses, in the watched project directory: no build starts, but -b still reads the tree.
	before="$(watch_cycles)"
	reset_atimes
	echo "notes $mode" >notes.txt
	watch_settle 2
	other_cycles=$(( $(watch_cycles) - before ))
	other_read=$(dirs_read)
	log "$label: write notes.txt: $other_cycles cycles, $other_read of ${#dirs[@]} directories read"
	watch_stop
	cat "$WATCH_LOG" >&2
	min="$(printf '%s\n' "${results[@]}" | sort -n | head -1)"
	summary+="$label: ${results[*]} of ${#dirs[@]} directories read per edit, $other_read after writing notes.txt ($other_cycles cycles); "
	[[ "$mode" == build ]] && (( min > 0 )) && reproduced=1
done

verdict "$reproduced" "${summary}expected 0 for an edit to a file already in the program"
