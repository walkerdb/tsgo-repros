// Renames an identifier with visitEachChild, prints the text range of each rebuilt node next to the original's, and
// prints the file. Usage: node repro.mjs <typescript package dir> <tsgo binary> <work dir>
// Prints the ranges and output, then "VERDICT <1|0> <summary>".
import path from "node:path";
import { fileURLToPath } from "node:url";

const [pkgDir, tsgo, workDir] = process.argv.slice(2);
const lib = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../lib/api-sdk.mjs");
const { loadSdk, parseForPrinting } = await import(lib);
const { sync, factory, visitor, is } = await loadSdk(pkgDir);

// No comment at offset 0, so 0033 (synthesized nodes printed as if at offset 0) does not add comments.
const text = `export type B = {\n  x: Foo /* trailing */\n  y: Foo // eol\n  z: Bar /* kept */\n}\n`;
const comments = ["/* trailing */", "// eol", "/* kept */"];
const api = new sync.API({ tsserverPath: tsgo, cwd: workDir });
try {
	const { sourceFile: sf, print } = parseForPrinting(api, workDir, "b.ts", text);
	const rename = (node) =>
		is.isIdentifier(node) && node.text === "Foo" ? factory.createIdentifier("NFoo") : visitor.visitEachChild(node, rename);
	const original = sf.statements[0];
	const rebuilt = rename(original);

	const range = (n) => `${n.pos}..${n.end}`.padEnd(8);
	const show = (name, o, r) =>
		console.log(`${name.padEnd(34)} original ${range(o)} updated ${range(r)}${o === r ? " (same node)" : ""}`);
	show("type alias", original, rebuilt);
	show("type literal", original.type, rebuilt.type);
	show("x: Foo  (property signature)", original.type.members[0], rebuilt.type.members[0]);
	show("Foo     (type reference)", original.type.members[0].type, rebuilt.type.members[0].type);
	show("z: Bar  (untouched sibling)", original.type.members[2], rebuilt.type.members[2]);
	const ref = original.type.members[0].type;
	const direct = factory.updateTypeReferenceNode(ref, factory.createIdentifier("NFoo"), ref.typeArguments);
	show("updateTypeReferenceNode(Foo, NFoo)", ref, direct);

	const out = print(factory.updateSourceFile(sf, [rebuilt], sf.endOfFileToken));
	console.log("--- printed:");
	console.log(out);
	const missing = comments.filter((c) => !out.includes(c));
	const summary = missing.length
		? `${missing.length} of ${comments.length} comments lost (${missing.join(", ")}); rebuilt nodes have range ${rebuilt.pos}..${rebuilt.end}`
		: `all ${comments.length} comments kept`;
	console.log(`VERDICT ${missing.length > 0 ? 1 : 0} ${summary}`);
} finally {
	api.close();
}
