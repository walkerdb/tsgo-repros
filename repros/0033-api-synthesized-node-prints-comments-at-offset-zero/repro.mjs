// Parses a file whose first comment is at offset 0, renames an identifier with visitEachChild, and prints the file.
// Usage: node repro.mjs <typescript package dir> <tsgo binary> <work dir>
// Prints both outputs, then "VERDICT <1|0> <summary>".
import path from "node:path";
import { fileURLToPath } from "node:url";

const [pkgDir, tsgo, workDir] = process.argv.slice(2);
const lib = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../lib/api-sdk.mjs");
const { loadSdk, parseForPrinting } = await import(lib);
const { sync, factory, visitor, is } = await loadSdk(pkgDir);

const text = `/* HEADER */\nimport { Foo } from "./foo"\nexport type A = Foo | { x: Foo }\n`;
const api = new sync.API({ tsserverPath: tsgo, cwd: workDir });
try {
	const { sourceFile: sf, print } = parseForPrinting(api, workDir, "a.ts", text);
	const rename = (node) =>
		is.isIdentifier(node) && node.text === "Foo" ? factory.createIdentifier("NFoo") : visitor.visitEachChild(node, rename);
	const rebuilt = rename(sf.statements[1]);
	const count = (s) => s.split("/* HEADER */").length - 1;

	const cases = [
		// Only the rebuilt type alias: the header comment belongs to the dropped import, so it should not be printed.
		["type alias only", [rebuilt], 0],
		// The original import plus the rebuilt type alias: the header should be printed once, before the import.
		["import + type alias", [sf.statements[0], rebuilt], 1],
	];
	let bad = 0;
	const summary = [];
	for (const [name, statements, expected] of cases) {
		const out = print(factory.updateSourceFile(sf, statements, sf.endOfFileToken));
		const got = count(out);
		console.log(`--- ${name}: /* HEADER */ printed ${got} time(s), expected ${expected}`);
		console.log(out);
		if (got !== expected) bad++;
		summary.push(`${name}: ${got} (expected ${expected})`);
	}
	console.log(`VERDICT ${bad > 0 ? 1 : 0} /* HEADER */ printed: ${summary.join("; ")}`);
} finally {
	api.close();
}
