// Without a package.json in the project, package.json lookups climb from the project to the filesystem root, and the
// language server merges the directories they visit into one watch on their common parent. Watch locations at or
// above the user's home directory are meant to be ineligible (/home/<name> and C:/Users/<name> are treated as part of
// the root), but /Users/<name> on macOS is not, so the server asks the client to watch all of /Users.
//
// Two sessions with a client that registers watchers itself (workspace.didChangeWatchedFiles.dynamicRegistration):
//   bare:    the project has no package.json
//   control: the same project with a package.json (lookups stop there)
// The bug reproduces when a watcher glob covers the home directory ($HOME) or one of its ancestors.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../../lib/lsp-client.mjs";

const work = process.argv[2];
const home = process.env.HOME.replace(/\/+$/, "");

function makeProject(name, withPackageJson) {
	const proj = join(work, name);
	mkdirSync(join(proj, "src"), { recursive: true });
	if (withPackageJson) writeFileSync(join(proj, "package.json"), '{ "name": "proj" }\n');
	writeFileSync(join(proj, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ["src"] }));
	writeFileSync(join(proj, "src", "a.ts"), "export const a = 1;\n");
	return proj;
}

// The directory a watcher glob covers: "<dir>/**/*" or { baseUri, pattern: "**/*" }.
function globDirectory(globPattern) {
	if (typeof globPattern === "string") return globPattern.endsWith("/**/*") ? globPattern.slice(0, -"/**/*".length) : undefined;
	const base = typeof globPattern.baseUri === "string" ? globPattern.baseUri : globPattern.baseUri.uri;
	return globPattern.pattern === "**/*" ? fileURLToPath(base).replace(/\/+$/, "") : undefined;
}

// Whether dir is the home directory or an ancestor of it (7.0.2 sends lowercased paths, hence the case folding).
function coversHome(dir) {
	const d = dir.toLowerCase() || "/";
	for (let p = home.toLowerCase(); ; p = dirname(p)) {
		if (p === d) return true;
		if (p === dirname(p)) return false;
	}
}

async function session(name, withPackageJson) {
	const proj = makeProject(name, withPackageJson);
	const server = startServer({ command: process.env.TSGO, cwd: proj });
	await server.initialize({ capabilities: { workspace: { didChangeWatchedFiles: { dynamicRegistration: true, relativePatternSupport: true } } } });
	const uri = server.open("src/a.ts");
	await server.request("textDocument/hover", { textDocument: { uri }, position: { line: 0, character: 13 } }, { timeoutMs: 30000 });
	await new Promise((r) => setTimeout(r, 2000));
	await server.shutdown();
	const dirs = [];
	for (const req of server.serverRequests) {
		if (req.method !== "client/registerCapability") continue;
		for (const reg of req.params.registrations) {
			if (reg.method !== "workspace/didChangeWatchedFiles") continue;
			for (const w of reg.registerOptions.watchers) {
				const dir = globDirectory(w.globPattern);
				if (dir !== undefined) dirs.push(dir);
			}
		}
	}
	const overHome = dirs.filter(coversHome);
	console.log(`${name}: ${dirs.length} recursive watcher(s)${overHome.length ? `; at or above $HOME: ${overHome.map((d) => `${d}/**/*`).join(", ")}` : "; none at or above $HOME"}`);
	return { dirs, overHome };
}

const bare = await session("bare", false);
const control = await session("control", true);
if (bare.dirs.length === 0) {
	console.log("VERDICT 2 the server registered no recursive watchers; inconclusive");
	process.exit(0);
}
if (control.overHome.length > 0) {
	console.log("VERDICT 2 control failed: a watcher covers $HOME even with a package.json in the project; inconclusive");
	process.exit(0);
}
console.log(
	`VERDICT ${bare.overHome.length > 0 ? 1 : 0} without a package.json the server asks the client to watch ${bare.overHome.length ? bare.overHome.map((d) => `${d}/**/*`).join(", ") : "nothing at or above $HOME"} ($HOME is ${home}); with one, nothing at or above $HOME`,
);
