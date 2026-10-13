# 0003: A content-mapped file's declaration output becomes an input of the next build

| | |
|-|-|
| Status | reproduces; not filed |
| Area | content mappers (`contentMappers`, `--runExternalCode`), `tsc -b`, `tsc --watch`, `tsc -b --watch` |
| Reproduces on | 7.1.0-dev.20261013.1 |
| Does not reproduce on | 7.0.2 (has no content mapper support: `error TS5072: Unknown build option '--runExternalCode'`) |
| Upstream | not filed yet |

## Run

```sh
./repro.sh                    # latest release (reports that content mappers are not supported)
TSGO_VERSION=next ./repro.sh  # nightly
```

Exits 1 while the bug reproduces, 0 once it is fixed (or when the tsgo under test has no content mappers). Needs
`node`, which runs the mapper (`mapper.js` in this directory). The script builds with `tsc -b` twice with an edit in
between, then runs `tsc --watch` and `tsc -b --watch` from a clean state with one edit and counts cycles over 5 s.
It takes about 20 s.

## Bug report draft (for microsoft/TypeScript)

Title: Declaration output of a content-mapped file is picked up as an input (TS5055, endless `tsc -b --watch` loop)

### Summary

With a content mapper for `.vue` and `declaration: true` but no `outDir`, the first build writes `v.d.vue.ts` next to
`v.vue`. The default include (`**/*`) matches `v.d.vue.ts` as a `.ts` file, and nothing excludes it as the output of
`v.vue`, so every later build takes it as an input:

- the next `tsc -b` after an edit (or any `tsc -p .`) fails with TS5055;
- `tsc --watch` reports TS5055 from the second cycle after the first edit on;
- `tsc -b --watch` never stops: every cycle reports TS5055 and still rewrites `v.d.vue.ts`, which is now a root file,
  so the write starts the next cycle (62-63 cycles in 5 s after one edit).

For `.ts` inputs this cannot happen: `a.d.ts` next to `a.ts` is dropped as a lower-priority extension of the same name.

### Repro

The mapper (`node_modules/verbatim-mapper/mapper.js`) serves the file's text unchanged as TypeScript:

```js
let buf = Buffer.alloc(0);
process.stdin.on("data", chunk => {
	buf = Buffer.concat([buf, chunk]);
	for (;;) {
		const headerEnd = buf.indexOf("\r\n\r\n");
		if (headerEnd < 0) return;
		const length = Number(/Content-Length: *(\d+)/i.exec(buf.subarray(0, headerEnd).toString())[1]);
		if (buf.length < headerEnd + 4 + length) return;
		const msg = JSON.parse(buf.subarray(headerEnd + 4, headerEnd + 4 + length).toString());
		buf = buf.subarray(headerEnd + 4 + length);
		if (msg.id !== undefined) reply(msg.id, handle(msg.method, msg.params));
	}
});
function handle(method, params) {
	switch (method) {
		case "initialize": return { positionEncoding: "utf-8", diagnosticSource: "verbatim" };
		case "openProject": return {};
		case "closeProject": return null;
		case "transform": return { text: params.content, extension: ".ts" };
	}
	return null;
}
function reply(id, result) {
	const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, result }));
	process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
	process.stdout.write(body);
}
```

`node_modules/verbatim-mapper/package.json`:

```json
{ "name": "verbatim-mapper", "version": "1.0.0", "typescript": { "contentMapper": { "exec": ["node", "mapper.js"] } } }
```

The project:

```sh
echo '{}' > package.json
cat > tsconfig.json <<'JSON'
{
	"compilerOptions": { "declaration": true, "strict": true, "types": [] },
	"contentMappers": [{ "package": "verbatim-mapper", "extensions": [".vue"] }]
}
JSON
echo 'export const v: number = 1;' > v.vue
echo 'import { v } from "./v.vue"; export const m = v + 1;' > main.ts

tsc -b --runExternalCode     # exit 0, writes main.js, main.d.ts, v.d.vue.ts, tsconfig.tsbuildinfo
echo 'import { v } from "./v.vue"; export const m = v + 2;' > main.ts
tsc -b --runExternalCode     # TS5055
```

`package.json` and `"types": []` are not needed for the bug; they only keep the watch to the project directory.

Expected: the second build succeeds, and `v.d.vue.ts` is treated as the output of `v.vue`, not as an input.

Actual (7.1.0-dev.20261013.1):

```
$ tsc -b --runExternalCode; echo "exit $?"
exit 0
$ echo 'import { v } from "./v.vue"; export const m = v + 2;' > main.ts
$ tsc -b --runExternalCode; echo "exit $?"
error TS5055: Cannot write file '.../proj/v.d.vue.ts' because it would overwrite input file.
exit 1
```

`tsc -p . --runExternalCode --listFilesOnly` lists `v.vue`, `main.ts` and `v.d.vue.ts`. Without the edit, `tsc -b
--verbose` says "Project 'tsconfig.json' is up to date because newest input 'v.d.vue.ts' is older than output
'tsconfig.tsbuildinfo'".

`tsc -b --watch --runExternalCode` from a clean directory, one edit to `main.ts`:

```
08:49:08 PM - Starting compilation in watch mode...

08:49:09 PM - Found 0 errors. Watching for file changes.

08:49:10 PM - File change detected. Starting incremental compilation...

error TS5055: Cannot write file '.../proj/v.d.vue.ts' because it would overwrite input file.
08:49:10 PM - Found 1 error. Watching for file changes.

08:49:11 PM - File change detected. Starting incremental compilation...

error TS5055: Cannot write file '.../proj/v.d.vue.ts' because it would overwrite input file.
08:49:11 PM - Found 1 error. Watching for file changes.

08:49:11 PM - File change detected. Starting incremental compilation...
...
```

With `TS_WATCH_DEBUG=1`, each of these cycles is started by the previous one's writes:
`update main.js, update main.d.ts, update tsconfig.tsbuildinfo, update v.d.vue.ts`.

Script result (6 runs; the `tsc -b --watch` count was 62 or 63 each time):

```
second tsc -b: exit 1, 1 TS5055 errors; tsc --watch: 2 cycles in 5 s after 1 edit, 1 TS5055;
tsc -b --watch: 63 cycles in 5 s after 1 edit, 63 TS5055
```

### Impact

Any content-mapped project that emits declarations next to its sources breaks on the second build, and
`tsc -b --watch` spins at full CPU until stopped.

### Cause

Line numbers are at commit b85298b6 (2026-09-29); the npm builds may be from other commits.

`getFileNamesFromConfigSpecs` (`internal/tsoptions/tsconfigparsing.go:1934`) drops a wildcard match only when a file
of the same base name with a higher-priority extension exists (`hasFileWithHigherPriorityExtension`, :1875, and
`removeWildcardFilesWithLowerPriorityExtension`, :1907). Content mapper extensions are passed in as extra supported
extensions, but there is no rule that relates `v.d.vue.ts` to `v.vue`, so `v.d.vue.ts` stays a root file. The
program then reports TS5055 because the declaration output of `v.vue` is the same path. In `tsc -b --watch`,
`checkTasksForEventChanges` (`internal/execute/build/orchestrator.go:588-599`) resets a task when one of its root files
changes, and `v.d.vue.ts` is rewritten on every cycle (observed), which keeps the loop going.
