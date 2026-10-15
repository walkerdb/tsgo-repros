// Requests definition, source definition and prepareRename on `this` at each marker and prints where they point.
import { readFileSync } from "node:fs";
import { startServer, markerPosition } from "../../lib/lsp-client.mjs";

const cwd = process.argv[2];
const MARKER_LEN = "/*1*/".length;

const s = startServer({ command: process.env.TSGO, cwd });
await s.initialize({ capabilities: {} });

function fmt(r) {
	if (r.timedOut) return "timed out";
	if (r.error) return `error ${JSON.stringify(r.error.message)}`;
	const list = r.result == null ? [] : Array.isArray(r.result) ? r.result : [r.result];
	if (list.length === 0) return "no result";
	return list
		.map((l) => {
			const range = l.range ?? l.targetSelectionRange;
			const file = (l.uri ?? l.targetUri).replace(/.*\//, "");
			return `${file} ${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
		})
		.join(", ");
}

async function at(file, marker) {
	const text = readFileSync(`${cwd}/${file}`, "utf8");
	s.open(file);
	const p = markerPosition(text, marker);
	const position = { line: p.line, character: p.character + MARKER_LEN };
	const params = { textDocument: { uri: s.uri(file) }, position };
	const def = await s.request("textDocument/definition", params, { timeoutMs: 20000 });
	const src = await s.request("custom/textDocument/sourceDefinition", params, { timeoutMs: 20000 });
	const ren = await s.request("textDocument/prepareRename", params, { timeoutMs: 20000 });
	const lines = text.split("\n");
	const show = (r) => {
		const first = r.result == null ? undefined : Array.isArray(r.result) ? r.result[0] : r.result;
		const range = first?.range ?? first?.targetSelectionRange;
		if (!range) return "";
		return ` -> ${JSON.stringify(lines[range.start.line].slice(range.start.character, range.end.line === range.start.line ? range.end.character : undefined))} on line ${JSON.stringify(lines[range.start.line])}`;
	};
	console.log(`${marker} ${file} \`this\` at ${position.line}:${position.character}`);
	console.log(`  definition:       ${fmt(def)}${show(def)}`);
	console.log(`  sourceDefinition: ${fmt(src)}${show(src)}`);
	console.log(`  prepareRename:    ${ren.error ? `error ${JSON.stringify(ren.error.message)}` : JSON.stringify(ren.result)}`);
	return { def, src, ren };
}

const isFileStart = (r) => {
	const list = r.result == null ? [] : Array.isArray(r.result) ? r.result : [r.result];
	return list.some((l) => {
		const range = l.range ?? l.targetSelectionRange;
		return range.start.line === 0 && range.start.character === 0 && range.end.line === 0 && range.end.character === 0;
	});
};

const bug = await at("src/a.js", "/*1*/");
const control = await at("src/b.ts", "/*2*/");
await s.shutdown();

for (const r of [bug.def, bug.src, control.def]) if (r.timedOut || r.error) {
	console.log(`VERDICT 2 a request failed: ${JSON.stringify(r)}`);
	process.exit(0);
}
const controlLine = control.def.result?.[0]?.range?.start.line;
if (controlLine !== 5) {
	console.log(`VERDICT 2 control: definition on a TS this parameter should point at line 5, got ${fmt(control.def)}`);
} else {
	const n = [bug.def, bug.src].filter(isFileStart).length;
	console.log(`VERDICT ${n > 0 ? 1 : 0} ${n} of 2 requests (definition, sourceDefinition) on a JSDoc @this \`this\` return the empty range at 0:0, the start of the file; the TS this-parameter control points at the parameter`);
}
