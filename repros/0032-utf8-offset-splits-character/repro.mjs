// Opens a file with a non-ASCII character, inserts "x" with an incremental didChange at a given character offset, and
// hovers `s` to see what the server's copy of the text now holds.
//
// é (U+00E9) is 2 UTF-8 bytes, C3 A9; 😀 (U+1F600) is 2 UTF-16 code units (a surrogate pair).
//   Bug cases: a UTF-8 offset inside é, in a string literal (hover shows its type) and in a JSDoc comment (hover shows
//   the comment text as is).
//   Controls: a UTF-8 offset before é, and a UTF-16 offset between 😀's surrogates, which the server snaps back to the
//   start of the character.
import { writeFileSync } from "node:fs";
import { startServer } from "../../lib/lsp-client.mjs";

const cwd = process.argv[2];
const lit = (ch) => `export const s = "${ch}";\n`; // `export const s = "` is 18 characters
const doc = "/** é */\nexport const s = 1;\n"; // `/** ` is 4 characters
const cases = [
	{ name: "utf-8, string literal, offset 0:19 (between é's bytes)", enc: "utf-8", file: "src/utf8-literal.ts", text: lit("é"), at: { line: 0, character: 19 }, hoverAt: { line: 0, character: 13 }, expect: 'const s: "xé"', bug: true },
	{ name: "utf-8, JSDoc comment, offset 0:5 (between é's bytes)", enc: "utf-8", file: "src/utf8-doc.ts", text: doc, at: { line: 0, character: 5 }, hoverAt: { line: 1, character: 13 }, expect: "xé", bug: true },
	{ name: "utf-8, string literal, offset 0:18 (before é)", enc: "utf-8", file: "src/utf8-before.ts", text: lit("é"), at: { line: 0, character: 18 }, hoverAt: { line: 0, character: 13 }, expect: 'const s: "xé"', bug: false },
	{ name: "utf-16, string literal, offset 0:19 (between 😀's surrogates)", enc: "utf-16", file: "src/utf16-literal.ts", text: lit("😀"), at: { line: 0, character: 19 }, hoverAt: { line: 0, character: 13 }, expect: 'const s: "x😀"', bug: false },
];

const codePoints = (str) => [...str].filter((c) => c.codePointAt(0) > 0x7f).map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase()).join(" ");

let wrong = 0;
let controlWrong = 0;
for (const enc of ["utf-8", "utf-16"]) {
	const s = startServer({ command: process.env.TSGO, cwd });
	const init = await s.initialize({ capabilities: { general: { positionEncodings: [enc] }, textDocument: { hover: { contentFormat: ["plaintext"] } } } });
	const chosen = init.capabilities.positionEncoding ?? "utf-16";
	console.log(`client offers positionEncodings ["${enc}"]; server chose "${chosen}"`);
	if (chosen !== enc) {
		await s.shutdown();
		console.log(`VERDICT 2 the server did not pick ${enc}`);
		process.exit(0);
	}
	for (const c of cases.filter((c) => c.enc === enc)) {
		writeFileSync(`${cwd}/${c.file}`, c.text);
		const uri = s.open(c.file, c.text);
		s.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ range: { start: c.at, end: c.at }, text: "x" }] });
		const h = await s.request("textDocument/hover", { textDocument: { uri }, position: c.hoverAt }, { timeoutMs: 20000 });
		if (h.timedOut || h.error) throw new Error(`hover failed: ${JSON.stringify(h)}`);
		const shown = h.result?.contents?.value ?? JSON.stringify(h.result);
		const ok = shown.includes(c.expect);
		if (!ok) c.bug ? wrong++ : controlWrong++;
		const cps = codePoints(shown);
		console.log(`  ${c.name}: hover on s ${ok ? "ok" : "WRONG"}: ${JSON.stringify(shown)}${cps ? ` (non-ASCII: ${cps})` : ""}; expected it to contain ${JSON.stringify(c.expect)}`);
	}
	await s.shutdown();
}
if (controlWrong > 0) {
	console.log(`VERDICT 2 ${controlWrong} control case(s) also wrong; the repro setup is broken`);
} else {
	console.log(`VERDICT ${wrong > 0 ? 1 : 0} ${wrong} of 2 UTF-8 edits inside é split it (hover shows U+FFFD in place of each half); the UTF-8 control and the UTF-16 offset between surrogates are right`);
}
