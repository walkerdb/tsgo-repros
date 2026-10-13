// Requests signature help at each marker and compares the signature shown with the one expected.
import { readFileSync } from "node:fs";
import { startServer, markerPosition } from "../../lib/lsp-client.mjs";

const cwd = process.argv[2];
const cases = [
	{ file: "src/tagged.ts", marker: "/*1*/", what: "tagged template inside a call", expect: "tag(", nested: true },
	{ file: "src/tagged.ts", marker: "/*2*/", what: "tagged template, not nested", expect: "tag(", nested: false },
	{ file: "src/tagged.ts", marker: "/*3*/", what: "call inside a call", expect: "inner(", nested: false },
	{ file: "src/jsx.tsx", marker: "/*4*/", what: "JSX element inside a call", expect: "Comp(", nested: true },
	{ file: "src/jsx.tsx", marker: "/*5*/", what: "JSX element, not nested", expect: "Comp(", nested: false },
];

const s = startServer({ command: process.env.TSGO, cwd });
await s.initialize({ capabilities: { textDocument: { signatureHelp: { signatureInformation: { parameterInformation: { labelOffsetSupport: true } } } } } });
const opened = new Set();
let wrongNested = 0;
let wrongControl = 0;
for (const c of cases) {
	const text = readFileSync(`${cwd}/${c.file}`, "utf8");
	if (!opened.has(c.file)) {
		s.open(c.file);
		opened.add(c.file);
	}
	const r = await s.request(
		"textDocument/signatureHelp",
		{ textDocument: { uri: s.uri(c.file) }, position: markerPosition(text, c.marker), context: { triggerKind: 1, isRetrigger: false } },
		{ timeoutMs: 20000 },
	);
	if (r.timedOut || r.error) throw new Error(`signatureHelp at ${c.marker} failed: ${JSON.stringify(r)}`);
	const labels = (r.result?.signatures ?? []).map((x) => x.label);
	const active = labels[r.result?.activeSignature ?? 0] ?? "(none)";
	const ok = active.startsWith(c.expect);
	if (!ok) c.nested ? wrongNested++ : wrongControl++;
	console.log(`${c.marker} ${c.what}: ${ok ? "ok" : "WRONG"}, shows ${JSON.stringify(active)}, expected ${c.expect}...)`);
}
await s.shutdown();
if (wrongControl > 0) {
	console.log(`VERDICT 2 ${wrongControl} control case(s) also wrong; the repro setup is broken`);
} else {
	console.log(`VERDICT ${wrongNested > 0 ? 1 : 0} ${wrongNested} of 2 nested cases (tagged template, JSX element) show the outer call's signature; 3 of 3 controls are right`);
}
