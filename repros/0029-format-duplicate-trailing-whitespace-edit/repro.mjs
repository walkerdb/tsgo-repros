// Formats src/a.ts three ways and checks each response for overlapping TextEdits:
//   - textDocument/formatting (control: one delete for line 1's trailing whitespace)
//   - textDocument/rangeFormatting from the start of line 1 to the end of line 2 (`// two`)
//   - textDocument/onTypeFormatting for "\n" at 2:0, as after pressing Enter before `// two`
import { startServer } from "../../lib/lsp-client.mjs";

const cwd = process.argv[2];
const options = { tabSize: 4, insertSpaces: true, trimTrailingWhitespace: true };

const s = startServer({ command: process.env.TSGO, cwd });
await s.initialize({});
const uri = s.open("src/a.ts");
const textDocument = { uri };
const requests = [
	["formatting", "textDocument/formatting", { textDocument, options }],
	["rangeFormatting 1:0-2:6", "textDocument/rangeFormatting", { textDocument, options, range: { start: { line: 1, character: 0 }, end: { line: 2, character: 6 } } }],
	['onTypeFormatting "\\n" at 2:0', "textDocument/onTypeFormatting", { textDocument, options, position: { line: 2, character: 0 }, ch: "\n" }],
];

const key = (p) => p.line * 1e9 + p.character;
const show = (e) => `${e.range.start.line}:${e.range.start.character}-${e.range.end.line}:${e.range.end.character} ${JSON.stringify(e.newText)}`;
function overlaps(edits) {
	const pairs = [];
	for (let i = 0; i < edits.length; i++) {
		for (let j = i + 1; j < edits.length; j++) {
			const a = edits[i].range;
			const b = edits[j].range;
			const same = key(a.start) === key(b.start) && key(a.end) === key(b.end);
			if (same || (key(a.start) < key(b.end) && key(b.start) < key(a.end))) pairs.push(`${show(edits[i])} / ${show(edits[j])}`);
		}
	}
	return pairs;
}

const bad = [];
let controlBroken;
for (const [name, method, params] of requests) {
	const r = await s.request(method, params, { timeoutMs: 20000 });
	if (r.timedOut || r.error) throw new Error(`${method} failed: ${JSON.stringify(r)}`);
	const edits = r.result ?? [];
	const pairs = overlaps(edits);
	console.log(`${name}: ${edits.length} edits [${edits.map(show).join("; ")}]${pairs.length ? `  <- overlapping: ${pairs.join(", ")}` : ""}`);
	if (method === "textDocument/formatting") {
		if (edits.length !== 1 || show(edits[0]) !== '1:0-1:2 ""') controlBroken = JSON.stringify(edits);
	} else if (pairs.length) {
		bad.push(name);
	}
}
await s.shutdown();

if (controlBroken) {
	console.log(`VERDICT 2 document formatting did not return the one expected delete of line 1's trailing whitespace: ${controlBroken}`);
} else {
	console.log(`VERDICT ${bad.length ? 1 : 0} ${bad.length} of 2 requests returned overlapping edits${bad.length ? ` (${bad.join(", ")})` : ""}; document formatting returns the delete once`);
}
