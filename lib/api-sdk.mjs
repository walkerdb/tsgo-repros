// Loads the JS API SDK that ships in the typescript 7 package, and parses and prints a file with it on any 7.x
// version. The export paths are `typescript/unstable/*` in 7.0 and `typescript/*` in 7.1.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadSdk(pkgDir) {
	const { exports } = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
	const load = (subpath) => {
		const target = exports[`./${subpath}`] ?? exports[`./unstable/${subpath}`];
		if (!target) throw new Error(`typescript has no export for ${subpath}`);
		return import(pathToFileURL(path.join(pkgDir, target)).href);
	};
	return {
		sync: await load("sync"),
		factory: await load("ast/factory"),
		visitor: await load("ast/visitor"),
		is: await load("ast/is"),
	};
}

// Parses `text` as `dir/fileName` and returns the source file and a function that prints a source file with the
// server's printer. 7.1+ has api.createSourceFile and api.printer.printFile. 7.0 has neither, so the file is written to
// disk, opened in a project, and printed with project.emitter.printNode.
export function parseForPrinting(api, dir, fileName, text) {
	const file = path.join(dir, fileName);
	if (typeof api.createSourceFile === "function") {
		const { sourceFile } = api.createSourceFile(file, text);
		return { sourceFile, print: (sf) => api.printer.printFile(sf) };
	}
	const config = path.join(dir, "tsconfig.json");
	fs.writeFileSync(config, JSON.stringify({ files: [fileName] }));
	fs.writeFileSync(file, text);
	const project = api.updateSnapshot({ openProjects: [config] }).getProject(config);
	return { sourceFile: project.program.getSourceFile(file), print: (sf) => project.emitter.printNode(sf) };
}
