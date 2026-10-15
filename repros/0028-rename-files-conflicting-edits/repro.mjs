// Sends one workspace/willRenameFiles request that moves src/a.ts and src/b.ts together into src/moved/ (a.ts imports
// b.ts, so its import needs no change), and checks whether any document gets two edits whose ranges overlap.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { startServer } from "../../lib/lsp-client.mjs";

const cwd = process.argv[2];
const s = startServer({ command: process.env.TSGO, cwd });
await s.initialize({
	capabilities: { workspace: { workspaceEdit: { documentChanges: true, resourceOperations: ["rename"] }, fileOperations: { willRename: true } } },
});
s.open("src/a.ts");
const files = [
	{ oldUri: s.uri("src/a.ts"), newUri: s.uri("src/moved/a.ts") },
	{ oldUri: s.uri("src/b.ts"), newUri: s.uri("src/moved/b.ts") },
];
const r = await s.request("workspace/willRenameFiles", { files }, { timeoutMs: 20000 });
await s.shutdown();
if (r.timedOut || r.error) throw new Error(`willRenameFiles failed: ${JSON.stringify(r)}`);

const root = s.uri(".") + "/";
const rel = (uri) => uri.replace(root, "");
const lineCol = (p) => `${p.line + 1}:${p.character + 1}`;
const before = (a, b) => a.line < b.line || (a.line === b.line && a.character < b.character);
const overlaps = (x, y) => before(x.start, y.end) && before(y.start, x.end);

const byFile = new Map();
for (const change of r.result?.documentChanges ?? []) {
	if (!change.textDocument) continue;
	const file = rel(change.textDocument.uri);
	if (!byFile.has(file)) byFile.set(file, []);
	byFile.get(file).push(...change.edits);
}
let conflicts = 0;
for (const [file, edits] of [...byFile].sort()) {
	const lines = readFileSync(resolve(cwd, file), "utf8").split("\n");
	edits.forEach((e, i) => {
		const old = lines[e.range.start.line].slice(e.range.start.character, e.range.end.character);
		const clash = edits.some((o, j) => j !== i && overlaps(e.range, o.range));
		console.log(`${file}:${lineCol(e.range.start)}-${lineCol(e.range.end)}: ${JSON.stringify(old)} -> ${JSON.stringify(e.newText)}${clash ? "  <- overlaps another edit" : ""}`);
	});
	for (let i = 0; i < edits.length; i++) for (let j = i + 1; j < edits.length; j++) if (overlaps(edits[i].range, edits[j].range)) conflicts++;
}
console.log(`VERDICT ${conflicts > 0 ? 1 : 0} ${conflicts} pair(s) of overlapping edits, ${[...byFile.values()].flat().length} edit(s) in all (expected none: "./b.js" is still right after both files move)`);
