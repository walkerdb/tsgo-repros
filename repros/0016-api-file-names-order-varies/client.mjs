// Opens the project in ./proj through the --api server, adds a file to src/, and prints the project's
// parsedCommandLine.fileNames (relative to the project) after the update. Usage:
//   node client.mjs <typescript package dir> <tsgo binary> layer|disk
// layer: the new file is supplied in a request file system layer (createSnapshot/update, 7.1+).
// disk:  the new file is written to disk and reported as created (fileNotifications in 7.1+, fileChanges in 7.0).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [pkgDir, tsgo, mode] = process.argv.slice(2);
const { API } = await import(pathToFileURL(path.join(pkgDir, "dist/api/sync/api.js")).href);
const root = path.resolve("proj");
const config = `${root}/tsconfig.json`;
const added = `${root}/src/added.ts`;
const api = new API({ tsserverPath: tsgo, cwd: process.cwd() });
const relative = (names) => names.map((f) => path.relative(root, f)).join(" ");
try {
	if (typeof api.createSnapshot === "function") {
		const first = api.createSnapshot({ openProjects: [config] });
		let second;
		if (mode === "layer") {
			second = first.update({ fileSystem: { kind: "layer", files: { [added]: "export const added = 1;\n" } }, ensurePrograms: true });
		} else {
			fs.writeFileSync(added, "export const added = 1;\n");
			second = first.update({ fileNotifications: { created: [added] }, ensurePrograms: true });
		}
		console.log(relative(second.getConfiguredProject(config).parsedCommandLine.fileNames));
	} else {
		if (mode === "layer") {
			console.log("unsupported: this version's API has no request file system");
			process.exit(0);
		}
		api.updateSnapshot({ openProjects: [config] });
		fs.writeFileSync(added, "export const added = 1;\n");
		const second = api.updateSnapshot({ fileChanges: { created: [added] } });
		console.log(relative(second.getProject(config).rootFiles));
	}
} finally {
	fs.rmSync(added, { force: true });
	api.close();
}
