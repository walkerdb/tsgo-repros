// Sends textDocument/formatting for src/a.ts (one line one level deep) with insertSpaces and several tabSize values,
// each in a fresh server. A watchdog samples the server's RSS every 200 ms and SIGKILLs it once RSS passes LIMIT_KB or
// after TIME_MS, so the huge case can never take the machine down.
import { execFileSync } from "node:child_process";
import { startServer } from "../../lib/lsp-client.mjs";

const cwd = process.argv[2];
const LIMIT_KB = 2 * 1024 * 1024;
const TIME_MS = 20000;
const HUGE = 1e9;

const rssKB = (pid) => {
	try {
		return Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString().trim()) || 0;
	} catch {
		return 0; // the process is gone
	}
};
const mb = (kb) => `${Math.round(kb / 1024)} MB`;

async function format(tabSize) {
	const s = startServer({ command: process.env.TSGO, cwd });
	await s.initialize({});
	const uri = s.open("src/a.ts");
	// Load the project first so the baseline RSS and the timing cover only the formatting request.
	await s.request("textDocument/documentSymbol", { textDocument: { uri } }, { timeoutMs: 20000 });
	const pid = s.child.pid;
	const baseKB = rssKB(pid);
	const samples = [];
	let peakKB = baseKB;
	let killed;
	const t0 = Date.now();
	const watchdog = setInterval(() => {
		const kb = rssKB(pid);
		const t = Date.now() - t0;
		peakKB = Math.max(peakKB, kb);
		samples.push(`${(t / 1000).toFixed(1)}s ${mb(kb)}`);
		if (kb > LIMIT_KB) killed = `RSS ${mb(kb)} passed ${mb(LIMIT_KB)} after ${(t / 1000).toFixed(1)} s`;
		else if (t > TIME_MS) killed = `no reply after ${TIME_MS / 1000} s (RSS ${mb(kb)})`;
		if (killed) {
			clearInterval(watchdog);
			s.child.kill("SIGKILL");
		}
	}, 200);
	const r = await s.request("textDocument/formatting", { textDocument: { uri }, options: { tabSize, insertSpaces: true } }, { timeoutMs: TIME_MS + 10000 });
	const ms = Date.now() - t0;
	clearInterval(watchdog);
	peakKB = Math.max(peakKB, rssKB(pid));
	if (s.exited || killed) await s.kill();
	else await s.shutdown();
	return { tabSize, r, ms, baseKB, peakKB, samples, killed, exited: s.exited };
}

function describe(x) {
	const head = `tabSize ${x.tabSize}: `;
	if (x.killed) return `${head}killed by the watchdog: ${x.killed}; RSS samples [${x.samples.join(", ")}]`;
	if (!x.r.result) return `${head}no result (${JSON.stringify(x.r).slice(0, 200)}), server exit ${JSON.stringify(x.exited)}, peak RSS ${mb(x.peakKB)}`;
	const edits = x.r.result.map((e) => `${e.range.start.line}:${e.range.start.character} insert ${e.newText.length} spaces`).join("; ");
	return `${head}answered in ${x.ms} ms, RSS ${mb(x.baseKB)} -> peak ${mb(x.peakKB)}, edits [${edits}]`;
}

const results = [];
for (const tabSize of [4, 1e6, 1e7, HUGE]) {
	const x = await format(tabSize);
	results.push(x);
	console.log(describe(x));
}

const control = results[0];
const controlOk = control.r.result?.length === 1 && control.r.result[0].newText === "    ";
const huge = results.at(-1);
if (!controlOk) {
	console.log(`VERDICT 2 the tabSize 4 control did not return one 4-space indent: ${JSON.stringify(control.r).slice(0, 200)}`);
} else if (huge.killed?.startsWith("RSS")) {
	console.log(`VERDICT 1 tabSize ${HUGE}: ${huge.killed} and still rising (tabSize 4 answered in ${control.ms} ms at ${mb(control.peakKB)})`);
} else if (!huge.r.result) {
	console.log(`VERDICT 1 tabSize ${HUGE}: no reply (${huge.killed ?? "server exited"}), peak RSS ${mb(huge.peakKB)} (tabSize 4 answered in ${control.ms} ms)`);
} else {
	const longest = Math.max(0, ...huge.r.result.map((e) => e.newText.length));
	console.log(`VERDICT ${longest > 1e6 ? 1 : 0} tabSize ${HUGE} answered in ${huge.ms} ms with peak RSS ${mb(huge.peakKB)}; longest indent ${longest} characters`);
}
