// macOS, language server with the builtin watcher: once ten watches sit anywhere under a directory, the next watch
// whose parent chain reaches that directory is merged into one recursive watch on it, however far up it is. Here
// ten pnpm-style store packages (store/pN/node_modules) and an import of ../shared merge into a recursive watch on an
// ancestor that holds them all, so writes in a directory no watch covers reach the server and overflow every watch.
//
// Two sessions, each in its own directory, writing and deleting 20k files in unrelated/, which no watch covers:
//   crowded: 10 store packages (the merge happens)
//   control:  3 store packages (too few to merge): the same writes must not reach the server
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../../lib/lsp-client.mjs";

const work = process.argv[2];
const FILES = 20000;
const ROUNDS = 3;

function makeProject(base, packages) {
	const proj = join(base, "proj");
	const shared = join(base, "shared");
	for (const dir of [join(proj, "src"), join(proj, "node_modules"), shared, join(base, "unrelated")]) mkdirSync(dir, { recursive: true });
	// package.json files stop package.json lookups from climbing past the work directory (they would make the server
	// watch a common ancestor such as /Users on their own).
	writeFileSync(join(shared, "package.json"), '{ "name": "shared" }\n');
	writeFileSync(join(shared, "x.ts"), "export const x = 1;\n");
	let src = "";
	for (let i = 0; i < packages; i++) {
		const real = join(base, "store", `p${i}`, "node_modules", `pkg${i}`);
		mkdirSync(real, { recursive: true });
		writeFileSync(join(real, "package.json"), JSON.stringify({ name: `pkg${i}`, types: "index.d.ts" }));
		writeFileSync(join(real, "index.d.ts"), `export declare const v${i}: number;\n`);
		symlinkSync(real, join(proj, "node_modules", `pkg${i}`));
		src += `import { v${i} } from "pkg${i}";\n`;
	}
	src += 'import { x } from "../../shared/x";\nexport const y = x;\n';
	writeFileSync(join(proj, "package.json"), '{ "name": "proj" }\n');
	const compilerOptions = { strict: true, noEmit: true, types: [], module: "esnext", moduleResolution: "bundler" };
	writeFileSync(join(proj, "tsconfig.json"), JSON.stringify({ compilerOptions, include: ["src"] }));
	writeFileSync(join(proj, "src", "a.ts"), src);
	return proj;
}

async function session(name, packages) {
	const base = join(work, name);
	const proj = makeProject(base, packages);
	const unrelated = join(base, "unrelated");
	const server = startServer({ command: process.env.TSGO, cwd: proj });
	// No workspace.didChangeWatchedFiles.dynamicRegistration: the server watches files itself.
	await server.initialize({ capabilities: {} });
	const uri = server.open("src/a.ts");
	await server.request("textDocument/hover", { textDocument: { uri }, position: { line: 0, character: 10 } }, { timeoutMs: 30000 });
	await new Promise((r) => setTimeout(r, 2000));
	const logs = () => server.notifications.filter((n) => n.method === "window/logMessage").map((n) => n.params.message);
	const watches = logs().filter((m) => m.startsWith("Added new watch")).length;
	const overflows = () => logs().filter((m) => m.startsWith("lspwatcher: watch overflow")).length;
	let rounds = 0;
	while (overflows() === 0 && rounds < ROUNDS) {
		rounds++;
		for (let i = 0; i < FILES; i++) writeFileSync(join(unrelated, `f${i}`), "x");
		for (let i = 0; i < FILES; i++) rmSync(join(unrelated, `f${i}`));
		await new Promise((r) => setTimeout(r, 1000));
	}
	await new Promise((r) => setTimeout(r, 2000));
	await server.shutdown();
	const dirs = new Set(logs().filter((m) => m.startsWith("lspwatcher: watch overflow")).map((m) => m.match(/"([^"]+)"/)[1].toLowerCase()));
	const result = { watches, overflows: overflows(), dirs: dirs.size, rounds };
	console.log(`${name}: ${packages} store packages, ${watches} watches; writes in unrelated/ (${rounds} round(s) of ${FILES}): ${result.overflows} overflow line(s) for ${result.dirs} watched director(ies)`);
	return result;
}

const crowded = await session("crowded", 10);
const control = await session("control", 3);
if (control.overflows > 0) {
	console.log("VERDICT 2 control failed: writes in unrelated/ overflowed watches without a merge; inconclusive");
	process.exit(0);
}
console.log(
	`VERDICT ${crowded.overflows > 0 ? 1 : 0} writes in a directory no watch covers: ${crowded.overflows} overflow line(s) with 10 store packages (a recursive watch covers their common ancestor), ${control.overflows} with 3`,
);
