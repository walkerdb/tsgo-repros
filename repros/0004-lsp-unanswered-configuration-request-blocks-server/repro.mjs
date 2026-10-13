// The server sends workspace/configuration while handling `initialized` and waits for the answer on its only
// dispatch loop. Until the client answers, no later request is handled.
//
// Three sessions, each advertising workspace.configuration:
//   never:   the client never answers workspace/configuration
//   delayed: the client answers after DELAY_MS
//   prompt:  the client answers at once (control)
import { startServer, NO_REPLY } from "../../lib/lsp-client.mjs";

const cwd = process.argv[2];
const TIMEOUT_MS = 10000;
const DELAY_MS = 3000;

async function session(mode) {
	let configRequest;
	const s = startServer({
		command: process.env.TSGO,
		cwd,
		onServerRequest(msg) {
			if (msg.method !== "workspace/configuration" || mode === "prompt") return undefined;
			configRequest = msg;
			if (mode === "delayed") setTimeout(() => s.respond(msg.id, msg.params.items.map(() => null)), DELAY_MS);
			return NO_REPLY;
		},
	});
	await s.initialize({ capabilities: { workspace: { configuration: true } } });
	const uri = s.open("src/a.ts");
	const t0 = Date.now();
	const hover = await s.request("textDocument/hover", { textDocument: { uri }, position: { line: 0, character: 13 } }, { timeoutMs: TIMEOUT_MS });
	const ms = Date.now() - t0;
	const methods = s.serverRequests.map((r) => r.method);
	s.kill();
	const outcome = hover.timedOut ? `no response within ${TIMEOUT_MS} ms` : hover.result ? `answered in ${ms} ms: ${JSON.stringify(hover.result.contents.value)}` : `error ${JSON.stringify(hover.error)}`;
	console.log(`${mode}: hover ${outcome}; server-to-client requests seen: ${methods.join(", ")}`);
	return { timedOut: !!hover.timedOut, ok: !!hover.result, ms, sawConfig: methods.includes("workspace/configuration") };
}

const never = await session("never");
const delayed = await session("delayed");
const prompt = await session("prompt");
if (!prompt.ok || !never.sawConfig) {
	console.log(`VERDICT 2 control failed: prompt session hover ok=${prompt.ok}, never session saw workspace/configuration=${never.sawConfig}`);
	process.exit(0);
}
const reproduced = never.timedOut && delayed.ms >= DELAY_MS * 0.9;
console.log(
	`VERDICT ${reproduced ? 1 : 0} hover ${never.timedOut ? `got no response within ${TIMEOUT_MS} ms` : `answered in ${never.ms} ms`} while workspace/configuration was unanswered; took ${delayed.ms} ms when the answer came after ${DELAY_MS} ms; took ${prompt.ms} ms when answered at once`,
);
