// Runs initialize, opens a file, sends a hover, then shutdown + exit, and reports the exit status. Half the runs keep
// stdin open after `exit` (the server should exit on its own); half close it right after `exit`, which races with the
// server's own shutdown.
import { startServer } from "../../lib/lsp-client.mjs";

const cwd = process.argv[2];
const runsPerMode = 5;
const results = { open: [], closed: [] };
for (let i = 0; i < runsPerMode * 2; i++) {
	const mode = i % 2 === 0 ? "open" : "closed";
	const s = startServer({ command: process.env.TSGO, cwd });
	await s.initialize({ capabilities: {} });
	const uri = s.open("src/a.ts");
	const hover = await s.request("textDocument/hover", { textDocument: { uri }, position: { line: 0, character: 13 } }, { timeoutMs: 20000 });
	if (!hover.result) throw new Error(`hover failed: ${JSON.stringify(hover)}`);
	const e = await s.shutdown({ timeoutMs: 10000, closeStdin: mode === "closed" });
	if (!e.shutdown || !("result" in e.shutdown)) throw new Error(`shutdown failed: ${JSON.stringify(e.shutdown)}`);
	const stderrTail = e.stderr.trim().split("\n").slice(-1)[0] ?? "";
	console.log(`run ${i + 1} (stdin ${mode} after exit): shutdown -> ${JSON.stringify(e.shutdown.result)}; exit status ${e.code ?? "none"}${e.killedAfterTimeout ? " (killed: no exit within 10 s)" : ""}; last stderr line: ${JSON.stringify(stderrTail)}`);
	results[mode].push(e.code);
}
const nonzero = (xs) => xs.filter((c) => c !== 0).length;
const bad = nonzero(results.open) + nonzero(results.closed);
console.log(
	`VERDICT ${bad > 0 ? 1 : 0} nonzero exit status after shutdown+exit in ${nonzero(results.open)}/${runsPerMode} runs with stdin kept open (statuses ${results.open.join(",")}) and ${nonzero(results.closed)}/${runsPerMode} runs with stdin closed after exit (statuses ${results.closed.join(",")})`,
);
