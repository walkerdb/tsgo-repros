// Asks the --api server for completions at the end of `fooBar` in proj/src/a.ts, where `fooBarBaz` (exported from
// proj/src/b.ts) is an auto-import completion. Prints "<scenario> ok <n> entries, fooBarBaz: yes|no" or
// "<scenario> error <message>". Usage: node client.mjs <typescript package dir> <tsgo binary> <scenario>
//   default:   project proj/tsconfig.json, the file's default project
//   alt:       proj/tsconfig.json and proj/tsconfig.alt.json (same include) both open; completions in the alt project
//   synthetic: a program created with createPrograms from a.ts and b.ts (7.1+)
import path from "node:path";
import { pathToFileURL } from "node:url";

const [pkgDir, tsgo, scenario] = process.argv.slice(2);
const { API } = await import(pathToFileURL(path.join(pkgDir, "dist/api/sync/api.js")).href);
const root = path.resolve("proj");
const main = `${root}/tsconfig.json`;
const alt = `${root}/tsconfig.alt.json`;
const a = `${root}/src/a.ts`;
const position = "export {};\nfooBar".length;
const api = new API({ tsserverPath: tsgo, cwd: process.cwd() });
const modern = typeof api.createSnapshot === "function";
try {
	let project;
	if (scenario === "synthetic") {
		if (!modern) {
			console.log(`${scenario} unsupported`);
			process.exit(0);
		}
		const result = api.createSnapshot({ createPrograms: [{ rootFiles: [a, `${root}/src/b.ts`], compilerOptions: { module: 99, moduleResolution: 100 } }] });
		const snapshot = result.snapshot ?? result;
		project = snapshot.getProjects().find((p) => !p.configFileName);
	} else {
		const configs = scenario === "alt" ? [main, alt] : [main];
		const target = scenario === "alt" ? alt : main;
		if (modern) project = api.createSnapshot({ openProjects: configs }).getConfiguredProject(target);
		else project = api.updateSnapshot({ openProjects: configs }).getProject(target);
	}
	const service = modern ? project.languageService : project.checker;
	const result = service.getCompletionsAtPosition(a, position);
	const found = result?.entries?.some((e) => e.name === "fooBarBaz") ? "yes" : "no";
	console.log(`${scenario} ok ${result?.entries?.length ?? 0} entries, fooBarBaz: ${found}`);
} catch (error) {
	console.log(`${scenario} error ${String(error?.message ?? error).split("\n")[0]}`);
} finally {
	api.close();
}
