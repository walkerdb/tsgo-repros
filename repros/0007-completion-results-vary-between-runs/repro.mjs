// Starts RUNS fresh servers. Each requests completions after `use` in src/a.ts twice, with no edits in between.
// Compares the order of the returned items (the raw list order, before any client-side sorting).
import { startServer } from "../../lib/lsp-client.mjs";

const cwd = process.argv[2];
const RUNS = 6;
const lists = [];
const firstUseContextSource = [];
let sortKeysVary = false;
let firstSorted;
for (let run = 0; run < RUNS; run++) {
	const s = startServer({ command: process.env.TSGO, cwd });
	await s.initialize({ capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true, labelDetailsSupport: true } } } } });
	const uri = s.open("src/a.ts");
	for (let i = 0; i < 2; i++) {
		const r = await s.request("textDocument/completion", { textDocument: { uri }, position: { line: 1, character: 3 }, context: { triggerKind: 1 } }, { timeoutMs: 30000 });
		if (r.timedOut || r.error) throw new Error(`completion failed: ${JSON.stringify(r)}`);
		const items = (Array.isArray(r.result) ? r.result : r.result?.items ?? []).filter((x) => x.label.startsWith("use"));
		const list = items.map((x) => `${x.label}@${x.labelDetails?.description ?? "?"}`);
		lists.push(list);
		// What a client that sorts by (sortText, label) would show.
		const sorted = items.map((x) => `${x.sortText}|${x.label}|${x.labelDetails?.description}`).sort();
		firstSorted ??= sorted;
		if (JSON.stringify(sorted) !== JSON.stringify(firstSorted)) sortKeysVary = true;
		firstUseContextSource.push(list.find((x) => x.startsWith("useContext@"))?.split("@")[1] ?? "(missing)");
		console.log(`run ${run + 1} request ${i + 1}: ${items.length} items: ${list.slice(0, 6).join(" ")} ...`);
	}
	await s.shutdown();
}
const distinct = new Set(lists.map((l) => l.join(" "))).size;
const withinRun = lists.filter((l, i) => i % 2 === 1 && l.join(" ") !== lists[i - 1].join(" ")).length;
const sizes = new Set(lists.map((l) => l.length));
console.log(`first useContext item's module, per request: ${firstUseContextSource.join(", ")}`);
console.log(`sets of (sortText, label, module) identical across all requests: ${!sortKeysVary}; item counts: ${[...sizes].join(", ")}`);
if (lists[0].length < 20) {
	console.log(`VERDICT 2 expected at least 20 auto-import items, got ${lists[0].length}`);
} else {
	console.log(`VERDICT ${distinct > 1 ? 1 : 0} ${distinct} distinct item orders in ${lists.length} identical completion requests over ${RUNS} fresh servers; ${withinRun} of ${RUNS} servers returned a different order for the second identical request`);
}
