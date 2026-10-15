// Asks the server for the edits to rename src/old.ts to src/new.ts and checks whether any edit lands outside
// src/index.ts, the only file that imports src/old.ts. The other files only hold unresolved relative imports.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { startServer } from "../../lib/lsp-client.mjs";

const cwd = process.argv[2];
const s = startServer({ command: process.env.TSGO, cwd });
await s.initialize({
	capabilities: { workspace: { workspaceEdit: { documentChanges: true, resourceOperations: ["rename"] }, fileOperations: { willRename: true } } },
});
s.open("src/index.ts");
s.open("src/consumer.ts");
const r = await s.request("workspace/willRenameFiles", { files: [{ oldUri: s.uri("src/old.ts"), newUri: s.uri("src/new.ts") }] }, { timeoutMs: 20000 });
await s.shutdown();
if (r.timedOut || r.error) throw new Error(`willRenameFiles failed: ${JSON.stringify(r)}`);

const root = s.uri(".") + "/";
const rel = (uri) => uri.replace(root, "");
const lineCol = (p) => `${p.line + 1}:${p.character + 1}`;
const short = (t) => (t.length > 40 ? `${t.slice(0, 20)}...${t.slice(-14)} (${t.length} chars)` : t);
let controlEdited = false;
const extra = new Set();
// The server returns files in Go map order; sort them so the output is stable.
const docs = (r.result?.documentChanges ?? []).filter((c) => c.textDocument).sort((x, y) => rel(x.textDocument.uri).localeCompare(rel(y.textDocument.uri)));
for (const change of docs) {
	const file = rel(change.textDocument.uri);
	const lines = readFileSync(resolve(cwd, file), "utf8").split("\n");
	for (const e of change.edits) {
		const old = lines[e.range.start.line].slice(e.range.start.character, e.range.end.character);
		const isControl = file === "src/index.ts";
		if (isControl && e.newText === "./new.js") controlEdited = true;
		if (!isControl) extra.add(file);
		console.log(`${file}:${lineCol(e.range.start)}: ${JSON.stringify(short(old))} -> ${JSON.stringify(short(e.newText))}${isControl ? "" : "  <- unrelated"}`);
	}
}
if (!controlEdited) {
	console.log("VERDICT 2 the import of ./old.js in src/index.ts was not updated; the repro setup is broken");
} else {
	console.log(`VERDICT ${extra.size > 0 ? 1 : 0} renaming src/old.ts edited ${extra.size} file(s) that do not import it${extra.size ? `: ${[...extra].join(", ")}` : ""}`);
}
