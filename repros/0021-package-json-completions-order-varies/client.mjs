// Asks the --api server for completions inside `import {} from "|"` in proj/src/a.ts and prints the entry names in
// the order returned, then the distinct sortText values. Usage: node client.mjs <typescript package dir> <tsgo binary>
import path from "node:path";
import { pathToFileURL } from "node:url";

const [pkgDir, tsgo] = process.argv.slice(2);
const { API } = await import(pathToFileURL(path.join(pkgDir, "dist/api/sync/api.js")).href);
const root = path.resolve("proj");
const config = `${root}/tsconfig.json`;
const api = new API({ tsserverPath: tsgo, cwd: process.cwd() });
try {
	let service;
	if (typeof api.createSnapshot === "function") {
		service = api.createSnapshot({ openProjects: [config] }).getConfiguredProject(config).languageService;
	} else {
		service = api.updateSnapshot({ openProjects: [config] }).getProject(config).checker;
	}
	const result = service.getCompletionsAtPosition(`${root}/src/a.ts`, 'import {} from "'.length);
	const entries = result?.entries ?? [];
	console.log(entries.map((e) => e.name).join(" "));
	console.log(`sortText: ${[...new Set(entries.map((e) => e.sortText))].join(" ")}`);
} finally {
	api.close();
}
