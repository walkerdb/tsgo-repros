// Compares, for a \n line break and for U+2028 / U+2029, a #region / #endregion folding range and the completions
// after `/**` at the end of a line.
import { writeFileSync } from "node:fs";
import { startServer } from "../../lib/lsp-client.mjs";

const cwd = process.argv[2];
const breaks = [
	{ name: "LF", ch: "\n" },
	{ name: "U+2028", ch: " " },
	{ name: "U+2029", ch: " " },
];
const regionText = (b) => `// #region name${b}const a = 1;${b}// #endregion${b}`;
const jsdocText = (b) => `/**${b}function f(a: number) {}\n`;
for (const b of breaks) {
	writeFileSync(`${cwd}/src/region-${b.name}.ts`, regionText(b.ch));
	writeFileSync(`${cwd}/src/jsdoc-${b.name}.ts`, jsdocText(b.ch));
}

// LSP positions count only \n, \r\n and \r as line breaks, so in the U+2028 / U+2029 files everything before the
// final \n is on line 0. Returns the LSP position of the end of `needle` (UTF-16 columns).
function endOf(text, needle) {
	const end = text.indexOf(needle) + needle.length;
	const before = text.slice(0, end);
	const line = before.split(/\r\n|\r|\n/).length - 1;
	return { line, character: end - (Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r")) + 1) };
}

const s = startServer({ command: process.env.TSGO, cwd });
await s.initialize({
	capabilities: {
		textDocument: {
			foldingRange: { foldingRange: { collapsedText: true } },
			completion: { completionItem: { snippetSupport: true } },
		},
	},
});

let wrong = 0;
let controlWrong = 0;
for (const b of breaks) {
	const control = b.name === "LF";
	const file = `src/region-${b.name}.ts`;
	const text = regionText(b.ch);
	s.open(file);
	const r = await s.request("textDocument/foldingRange", { textDocument: { uri: s.uri(file) } }, { timeoutMs: 20000 });
	if (r.timedOut || r.error) throw new Error(`foldingRange failed: ${JSON.stringify(r)}`);
	const region = (r.result ?? []).find((x) => x.kind === "region");
	const want = endOf(text, "// #endregion");
	const ok = region && region.endLine === want.line && region.endCharacter === want.character && region.collapsedText === "name";
	if (!ok) control ? controlWrong++ : wrong++;
	const got = region ? `ends ${region.endLine}:${region.endCharacter}, collapsedText ${JSON.stringify(region.collapsedText)} (code points: ${[...region.collapsedText].map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join(" ")})` : "no region range";
	console.log(`foldingRange, ${b.name}: ${ok ? "ok" : "WRONG"}, ${got}; expected ends ${want.line}:${want.character}, collapsedText "name"`);
}
for (const b of breaks) {
	const control = b.name === "LF";
	const file = `src/jsdoc-${b.name}.ts`;
	s.open(file);
	const r = await s.request("textDocument/completion", { textDocument: { uri: s.uri(file) }, position: { line: 0, character: 3 } }, { timeoutMs: 20000 });
	if (r.timedOut || r.error) throw new Error(`completion failed: ${JSON.stringify(r)}`);
	const items = Array.isArray(r.result) ? r.result : (r.result?.items ?? []);
	const template = items.find((i) => i.label === "/** */");
	const tags = items.filter((i) => i.label.startsWith("@")).length;
	const ok = !!template;
	if (!ok) control ? controlWrong++ : wrong++;
	const got = template ? `JSDoc template ${JSON.stringify(template.textEdit?.newText ?? template.insertText)}` : `no JSDoc template; ${items.length} items, ${tags} JSDoc tags (${items.slice(0, 3).map((i) => i.label).join(", ")}, ...)`;
	console.log(`completion after "/**", ${b.name}: ${ok ? "ok" : "WRONG"}, ${got}`);
}
await s.shutdown();
if (controlWrong > 0) {
	console.log(`VERDICT 2 ${controlWrong} LF control case(s) also wrong; the repro setup is broken`);
} else {
	console.log(`VERDICT ${wrong > 0 ? 1 : 0} ${wrong} of 4 U+2028 / U+2029 cases differ from LF (folding range end and collapsed text, JSDoc template completion)`);
}
