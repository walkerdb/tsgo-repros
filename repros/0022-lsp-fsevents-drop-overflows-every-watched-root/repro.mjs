// macOS, language server with the builtin watcher (the client lacks dynamic watch registration): every watched root
// shares one FSEvents stream, and macOS reports a drop on every root of a stream, so a burst of writes under one
// watched directory makes every other watched directory overflow too.
//
// The project imports ../shared, so the server watches proj/, shared/ and its own lib directory. The client writes
// and deletes 20k files under proj/busy until the server logs an overflow for proj, then counts the overflows it
// logged for shared/, where nothing changed.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../../lib/lsp-client.mjs";

const base = process.argv[2];
const proj = join(base, "proj");
const shared = join(base, "shared");
const busy = join(proj, "busy");
const FILES = 20000;
const MAX_ROUNDS = 10;

for (const dir of [join(proj, "src"), shared, busy]) mkdirSync(dir, { recursive: true });
// A package.json in both directories stops package.json lookups from climbing to their ancestors, which would make
// the server watch a common ancestor (e.g. all of /Users) and hide which root overflowed.
writeFileSync(join(shared, "package.json"), '{ "name": "shared" }\n');
writeFileSync(join(shared, "x.ts"), "export const x = 1;\n");
writeFileSync(join(proj, "package.json"), '{ "name": "proj" }\n');
writeFileSync(join(proj, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ["src"] }));
writeFileSync(join(proj, "src", "a.ts"), 'import { x } from "../../shared/x";\nexport const y = x;\n');

const server = startServer({ command: process.env.TSGO, cwd: proj });
// No workspace.didChangeWatchedFiles.dynamicRegistration: the server watches files itself.
await server.initialize({ capabilities: {} });
const uri = server.open("src/a.ts");
await server.request("textDocument/hover", { textDocument: { uri }, position: { line: 1, character: 13 } }, { timeoutMs: 30000 });
await new Promise((r) => setTimeout(r, 2000));

const logs = () => server.notifications.filter((n) => n.method === "window/logMessage").map((n) => n.params.message);
// 7.0.2 logs lowercased paths.
const overflowsIn = (dir) => logs().filter((m) => m.toLowerCase().startsWith(`lspwatcher: watch overflow in "${dir.toLowerCase()}"`)).length;

let rounds = 0;
while (overflowsIn(proj) === 0 && rounds < MAX_ROUNDS) {
	rounds++;
	for (let i = 0; i < FILES; i++) writeFileSync(join(busy, `f${i}`), "x");
	for (let i = 0; i < FILES; i++) rmSync(join(busy, `f${i}`));
	await new Promise((r) => setTimeout(r, 1000));
}
await new Promise((r) => setTimeout(r, 2000));
await server.shutdown();

const projOverflows = overflowsIn(proj);
const sharedOverflows = overflowsIn(shared);
for (const line of new Set(logs().filter((m) => m.includes("watch overflow")).map((m) => m.split(" (")[0]))) {
	console.log(line.replace(base.toLowerCase(), "<work>").replace(base, "<work>"));
}
if (projOverflows === 0) {
	console.log(`VERDICT 2 fseventsd never dropped events for proj/ in ${rounds} rounds of ${FILES} writes; inconclusive`);
	process.exit(0);
}
console.log(
	`VERDICT ${sharedOverflows > 0 ? 1 : 0} writes only under proj/busy: ${projOverflows} overflow(s) logged for proj/, ${sharedOverflows} for shared/ (nothing changed there), after ${rounds} round(s) of ${FILES} writes`,
);
