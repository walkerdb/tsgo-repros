// Asks the server for the edits to rename src/styles.d.css.ts to three new names, each in a fresh session, and checks
// which ones include a RenameFile for the companion src/styles.css.
import { startServer } from "../../lib/lsp-client.mjs";

const cwd = process.argv[2];
const cases = [
	{ to: "src/theme.d.css.ts", companionExpected: true },
	{ to: "src/theme.d.ts", companionExpected: false },
	{ to: "src/theme.d.scss.ts", companionExpected: false },
];

let extra = 0;
let controlBroken = false;
for (const c of cases) {
	const s = startServer({ command: process.env.TSGO, cwd });
	await s.initialize({
		capabilities: { workspace: { workspaceEdit: { documentChanges: true, resourceOperations: ["rename"] }, fileOperations: { willRename: true } } },
	});
	s.open("src/index.ts");
	const r = await s.request("workspace/willRenameFiles", { files: [{ oldUri: s.uri("src/styles.d.css.ts"), newUri: s.uri(c.to) }] }, { timeoutMs: 20000 });
	await s.shutdown();
	if (r.timedOut || r.error) throw new Error(`willRenameFiles failed: ${JSON.stringify(r)}`);
	const root = s.uri(".") + "/";
	const rel = (uri) => uri.replace(root, "");
	const changes = r.result?.documentChanges ?? [];
	const renames = changes.filter((x) => x.kind === "rename").map((x) => `${rel(x.oldUri)} -> ${rel(x.newUri)}`);
	const edits = changes.filter((x) => x.textDocument).flatMap((x) => x.edits.map((e) => `${rel(x.textDocument.uri)}: ${JSON.stringify(e.newText)}`));
	const hasCompanion = renames.some((x) => x.startsWith("src/styles.css "));
	if (c.companionExpected && !hasCompanion) controlBroken = true;
	if (!c.companionExpected && hasCompanion) extra++;
	console.log(`styles.d.css.ts -> ${c.to.replace("src/", "")}: RenameFile [${renames.join("; ")}]; text edits [${edits.join("; ")}]${!c.companionExpected && hasCompanion ? "  <- extra RenameFile" : ""}`);
}
if (controlBroken) {
	console.log("VERDICT 2 the .d.css.ts -> .d.css.ts control did not rename styles.css; the repro setup is broken");
} else {
	console.log(`VERDICT ${extra > 0 ? 1 : 0} ${extra} of 2 renames to a different declaration kind also rename styles.css (control .d.css.ts -> .d.css.ts renames it as intended)`);
}
