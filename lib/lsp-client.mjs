// A small LSP client over stdio for repro scripts. Node 22, no dependencies.
//
//   import { startServer, fileUri, NO_REPLY } from "../../lib/lsp-client.mjs";
//   const server = startServer({ command: process.env.TSGO, args: ["--lsp", "--stdio"], cwd });
//   await server.initialize({ capabilities: { workspace: { configuration: true } } });
//   server.open("src/a.ts");
//   const r = await server.request("textDocument/hover", { ... }, { timeoutMs: 10000 });
//   // r is { result } or { error } or { timedOut: true }
//   const exit = await server.shutdown();   // { code, signal, stderr, shutdown }
//
// Server-to-client requests are answered by `onServerRequest(message)` when given. Return a value to send it as the
// result, or NO_REPLY to leave the request unanswered (answer it later with server.respond(id, result)). Without a
// handler, or when it returns undefined, the default answers are: workspace/configuration -> one null per item;
// everything else -> null.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const NO_REPLY = Symbol("NO_REPLY");

export function fileUri(path) {
	return pathToFileURL(resolve(path)).href;
}

export function languageIdFor(path) {
	if (/\.[cm]?tsx$/.test(path)) return "typescriptreact";
	if (/\.[cm]?ts$/.test(path)) return "typescript";
	if (/\.[cm]?jsx$/.test(path)) return "javascriptreact";
	if (/\.[cm]?js$/.test(path)) return "javascript";
	return "plaintext";
}

export function startServer({ command, args = ["--lsp", "--stdio"], cwd = process.cwd(), env = process.env, onServerRequest, trace = false }) {
	if (!command) throw new Error("startServer: no command (set TSGO)");
	// Resolve a relative command path against our cwd, not the server's.
	if (command.includes("/")) command = resolve(command);
	const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
	child.on("error", (err) => {
		stderr += `spawn error: ${err.message}\n`;
	});
	let nextId = 1;
	const pending = new Map();
	const serverRequests = [];
	const notifications = [];
	let stderr = "";
	let buffer = Buffer.alloc(0);
	let exited;
	const exitPromise = new Promise((res) => {
		child.on("exit", (code, signal) => {
			exited = { code, signal };
			for (const [, p] of pending) p.resolve({ error: { message: "server exited" }, exited: true });
			pending.clear();
			res(exited);
		});
	});
	child.stdin.on("error", () => {});
	child.stderr.on("data", (d) => {
		stderr += d;
		if (trace) process.stderr.write(d);
	});
	child.stdout.on("data", (chunk) => {
		buffer = Buffer.concat([buffer, chunk]);
		for (;;) {
			const headerEnd = buffer.indexOf("\r\n\r\n");
			if (headerEnd < 0) return;
			const header = buffer.subarray(0, headerEnd).toString("ascii");
			const m = /Content-Length: *(\d+)/i.exec(header);
			if (!m) throw new Error(`bad LSP header: ${header}`);
			const len = Number(m[1]);
			if (buffer.length < headerEnd + 4 + len) return;
			const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + len).toString("utf8");
			buffer = buffer.subarray(headerEnd + 4 + len);
			handle(JSON.parse(body));
		}
	});

	function send(msg) {
		if (exited) return;
		// JSON-RPC 2.0 allows only an object or array as params; omit them for void methods (shutdown, exit).
		if (msg.params == null) delete msg.params;
		const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...msg }), "utf8");
		if (trace) process.stderr.write(`--> ${body.toString().slice(0, 300)}\n`);
		child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
		child.stdin.write(body);
	}

	function defaultAnswer(msg) {
		if (msg.method === "workspace/configuration") return (msg.params?.items ?? []).map(() => null);
		return null;
	}

	function handle(msg) {
		if (trace) process.stderr.write(`<-- ${JSON.stringify(msg).slice(0, 300)}\n`);
		if (msg.id !== undefined && msg.method === undefined) {
			const p = pending.get(msg.id);
			if (p) {
				pending.delete(msg.id);
				clearTimeout(p.timer);
				p.resolve("error" in msg ? { error: msg.error } : { result: msg.result });
			}
			return;
		}
		if (msg.id !== undefined) {
			serverRequests.push(msg);
			let answer = onServerRequest ? onServerRequest(msg) : undefined;
			if (answer === NO_REPLY) return;
			if (answer === undefined) answer = defaultAnswer(msg);
			send({ id: msg.id, result: answer });
			return;
		}
		notifications.push(msg);
	}

	function request(method, params, { timeoutMs = 30000 } = {}) {
		const id = nextId++;
		return new Promise((res) => {
			const timer = setTimeout(() => {
				pending.delete(id);
				res({ timedOut: true, id });
			}, timeoutMs);
			pending.set(id, { resolve: res, timer });
			send({ id, method, params });
		});
	}

	function notify(method, params) {
		send({ method, params });
	}

	const versions = new Map();

	return {
		child,
		serverRequests,
		notifications,
		get stderr() {
			return stderr;
		},
		get exited() {
			return exited;
		},
		request,
		notify,
		// Answers a server-to-client request that the handler left unanswered with NO_REPLY.
		respond(id, result) {
			send({ id, result });
		},
		cancel(id) {
			notify("$/cancelRequest", { id });
		},
		async initialize({ capabilities = {}, initializationOptions, rootPath = cwd, timeoutMs = 30000 } = {}) {
			const r = await request(
				"initialize",
				{
					processId: process.pid,
					rootUri: fileUri(rootPath),
					workspaceFolders: [{ uri: fileUri(rootPath), name: "root" }],
					capabilities,
					initializationOptions,
				},
				{ timeoutMs },
			);
			if (!r.result) throw new Error(`initialize failed: ${JSON.stringify(r)}\n${stderr}`);
			notify("initialized", {});
			return r.result;
		},
		open(path, text = readFileSync(resolve(cwd, path), "utf8"), languageId = languageIdFor(path)) {
			const uri = fileUri(resolve(cwd, path));
			versions.set(uri, 1);
			notify("textDocument/didOpen", { textDocument: { uri, languageId, version: 1, text } });
			return uri;
		},
		change(path, text) {
			const uri = fileUri(resolve(cwd, path));
			const version = (versions.get(uri) ?? 1) + 1;
			versions.set(uri, version);
			notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] });
			return uri;
		},
		uri(path) {
			return fileUri(resolve(cwd, path));
		},
		// Sends shutdown, then exit, and waits for the process. Returns { code, signal, stderr, shutdown }, where
		// shutdown is the shutdown response. Kills the process if it has not exited after timeoutMs.
		// closeStdin: close our end of the server's stdin right after the exit notification (default), or keep it open
		// until the server exits.
		async shutdown({ timeoutMs = 10000, closeStdin = true } = {}) {
			const shutdownResponse = await request("shutdown", null, { timeoutMs });
			notify("exit", null);
			if (closeStdin) child.stdin.end();
			const e = await waitExit(timeoutMs);
			child.stdin.destroy();
			return { ...e, stderr, shutdown: shutdownResponse };
		},
		waitExit,
		kill() {
			if (!exited) child.kill("SIGKILL");
			return exitPromise;
		},
	};

	function waitExit(timeoutMs) {
		return Promise.race([
			exitPromise,
			new Promise((res) =>
				setTimeout(() => {
					if (!exited) child.kill("SIGKILL");
					res({ code: null, signal: "SIGKILL", killedAfterTimeout: true });
				}, timeoutMs),
			),
		]);
	}
}

// Converts a /*marker*/ in text to an LSP position (UTF-16 columns), at the start of the marker.
export function markerPosition(text, marker) {
	const offset = text.indexOf(marker);
	if (offset < 0) throw new Error(`marker ${marker} not found`);
	const before = text.slice(0, offset);
	const line = before.split("\n").length - 1;
	const character = offset - (before.lastIndexOf("\n") + 1);
	return { line, character };
}
