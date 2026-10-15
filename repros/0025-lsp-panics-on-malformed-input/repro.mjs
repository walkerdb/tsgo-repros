// Sends one piece of bad client input per fresh language server session and checks whether the server process dies.
// After the bad input, a session that is still running gets a hover on src/a.ts, to check that it still answers.
import { startServer, fileUri } from "../../lib/lsp-client.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const cwd = process.argv[2];
const only = process.argv[3]; // optional: run only the cases whose name contains this text
const text = readFileSync(resolve(cwd, "src/a.ts"), "utf8");
const aUri = fileUri(resolve(cwd, "src/a.ts"));
const hoverParams = { textDocument: { uri: aUri }, position: { line: 0, character: 13 } };

// A URI with no ":"; lsproto.DocumentUri.FileName panics with "invalid URI".
const BAD_URI = "untitled";
const pos = { line: 0, character: 0 };
const range = { start: pos, end: pos };
const item = (uri) => ({ name: "f", kind: 12, uri, range, selectionRange: range });
const req = (s, method, params) => s.request(method, params, { timeoutMs: 5000 });

// init: omitted (initialize + initialized + didOpen src/a.ts), "no-initialized" (initialize only), or "bad-root"
// (initialize with rootUri BAD_URI, then initialized). The control case must not crash, or the verdict is 2.
const cases = [
	{
		name: "control: hover on src/a.ts",
		input: "textDocument/hover on src/a.ts",
		control: true,
		run: (s) => req(s, "textDocument/hover", hoverParams),
	},
	{
		name: "hover on a URI with no scheme",
		input: `textDocument/hover {uri: "${BAD_URI}"}`,
		run: (s) => req(s, "textDocument/hover", { textDocument: { uri: BAD_URI }, position: pos }),
	},
	{
		name: "hover on a malformed file URI",
		input: `textDocument/hover {uri: "file:///%zz.ts"}`,
		run: (s) => req(s, "textDocument/hover", { textDocument: { uri: "file:///%zz.ts" }, position: pos }),
	},
	{
		name: "hover on a scheme://authority URI with no path",
		input: `textDocument/hover {uri: "foo://bar"}`,
		run: (s) => req(s, "textDocument/hover", { textDocument: { uri: "foo://bar" }, position: pos }),
	},
	{
		name: "didOpen of a URI with no scheme",
		input: `textDocument/didOpen {uri: "${BAD_URI}"}`,
		run: (s) => s.notify("textDocument/didOpen", { textDocument: { uri: BAD_URI, languageId: "typescript", version: 1, text: "" } }),
	},
	{
		name: "willRenameFiles to a URI with no scheme",
		input: `workspace/willRenameFiles {oldUri: src/a.ts, newUri: "${BAD_URI}"}`,
		run: (s) => req(s, "workspace/willRenameFiles", { files: [{ oldUri: aUri, newUri: BAD_URI }] }),
	},
	{
		name: "didChangeWatchedFiles with a URI with no scheme",
		input: `workspace/didChangeWatchedFiles {uri: "${BAD_URI}", type: 2}`,
		run: (s) => s.notify("workspace/didChangeWatchedFiles", { changes: [{ uri: BAD_URI, type: 2 }] }),
	},
	{
		name: "callHierarchy/incomingCalls with an item URI with no scheme",
		input: `callHierarchy/incomingCalls {item: {uri: "${BAD_URI}", ...}}`,
		run: (s) => req(s, "callHierarchy/incomingCalls", { item: item(BAD_URI) }),
	},
	{
		name: "callHierarchy/outgoingCalls with an item URI with no scheme",
		input: `callHierarchy/outgoingCalls {item: {uri: "${BAD_URI}", ...}}`,
		run: (s) => req(s, "callHierarchy/outgoingCalls", { item: item(BAD_URI) }),
	},
	{
		name: "didChange right after didClose",
		input: "didClose src/a.ts, then didChange src/a.ts (version 2); no further request",
		run: (s) => {
			s.notify("textDocument/didClose", { textDocument: { uri: aUri } });
			s.notify("textDocument/didChange", { textDocument: { uri: aUri, version: 2 }, contentChanges: [{ text: text + "\n" }] });
		},
	},
	{
		name: "completionItem/resolve with an empty data.fileName",
		input: `completionItem/resolve {label: "x", data: {fileName: "", position: 0}}`,
		run: (s) => req(s, "completionItem/resolve", { label: "x", data: { fileName: "", position: 0 } }),
	},
	{
		name: "codeLens/resolve without data",
		input: "codeLens/resolve {range}",
		run: (s) => req(s, "codeLens/resolve", { range }),
	},
	{
		name: "hover before initialized",
		input: "initialize, then textDocument/hover on src/a.ts before the initialized notification",
		init: "no-initialized",
		run: (s) => req(s, "textDocument/hover", hoverParams),
	},
	{
		name: "initialize with a rootUri with no scheme",
		input: `initialize {rootUri: "${BAD_URI}"}, then initialized`,
		init: "bad-root",
	},
];

const results = [];
for (const c of cases) {
	if (only && !c.control && !c.name.includes(only)) continue;
	results.push(await runCase(c));
}

const control = results.find((r) => r.control);
const crashed = results.filter((r) => !r.control && r.crashed);
const tried = results.length - 1;
if (control.crashed || control.followUp !== "answered") {
	console.log("VERDICT 2 the control session did not answer a plain hover; the repro setup is broken");
} else {
	console.log(
		`VERDICT ${crashed.length > 0 ? 1 : 0} ${crashed.length} of ${tried} bad inputs killed the server` +
			(crashed.length ? ` (${crashed.map((r) => r.name).join("; ")})` : ""),
	);
}

async function runCase(c) {
	const s = startServer({ command: process.env.TSGO, cwd });
	if (c.init === "no-initialized" || c.init === "bad-root") {
		const r = await s.request(
			"initialize",
			{ processId: process.pid, rootUri: c.init === "bad-root" ? BAD_URI : fileUri(cwd), capabilities: {} },
			{ timeoutMs: 10000 },
		);
		if (!r.result) throw new Error(`initialize failed: ${JSON.stringify(r)}\n${s.stderr}`);
		if (c.init === "bad-root") s.notify("initialized", {});
	} else {
		await s.initialize();
		s.open("src/a.ts");
	}

	let response;
	if (c.run) {
		const r = await c.run(s);
		if (r) response = describe(r);
	}
	// Notifications have no response. Wait past the session's 500 ms snapshot-update debounce, so a panic in the
	// scheduled update shows up before the follow-up request.
	await waitForExit(s, 1500);

	let followUp = "not sent (server had exited)";
	if (!s.exited) {
		if (c.init === "no-initialized") s.notify("initialized", {});
		if (c.init) s.open("src/a.ts");
		if (c.name.startsWith("didChange right after didClose")) s.open("src/a.ts");
		followUp = describe(await s.request("textDocument/hover", hoverParams, { timeoutMs: 10000 }));
	}
	const crashed = !!s.exited;
	if (!crashed) await s.shutdown({ timeoutMs: 5000 });

	const panic = s.stderr.split("\n").find((l) => l.startsWith("panic:"));
	const status = crashed ? `exited with status ${s.exited.code}${s.exited.signal ? ` (signal ${s.exited.signal})` : ""}` : "kept running";
	console.log(`${c.name}: ${crashed ? "CRASH" : "ok"}`);
	console.log(`    input:     ${c.input}`);
	if (response) console.log(`    response:  ${response}`);
	console.log(`    server:    ${status}; follow-up hover: ${followUp}`);
	if (panic) console.log(`    stderr:    ${panic}`);
	return { name: c.name, control: !!c.control, crashed, followUp };
}

function describe(r) {
	if (r.exited) return "no response (server exited)";
	if (r.timedOut) return "no response (timed out)";
	if (r.error) return `error ${r.error.code}: ${r.error.message.split("\n")[0].slice(0, 100)}`;
	return "answered";
}

function waitForExit(s, ms) {
	return Promise.race([s.exited ? Promise.resolve() : new Promise((res) => s.child.once("exit", res)), new Promise((res) => setTimeout(res, ms))]);
}
