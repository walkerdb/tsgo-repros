// Starts `tsgo --api` (msgpack) or `tsgo --api --async` (JSON-RPC with Content-Length framing), sends the start of
// one frame that declares a payload of <size> bytes but sends no payload, waits 1.5 s, and prints one JSON line with
// the server's VmSize/VmRSS (kB) before and after, its exit status after stdin is closed, and the start of stderr.
// Usage: node client.mjs <tsgo binary> msgpack|jsonrpc <size>
import { spawn } from "node:child_process";
import fs from "node:fs";

const [tsgo, protocol, sizeArg] = process.argv.slice(2);
const size = BigInt(sizeArg);
const child = spawn(tsgo, protocol === "jsonrpc" ? ["--api", "--async"] : ["--api"], { stdio: ["pipe", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (d) => (stderr += d));
child.stdout.resume();
child.stdin.on("error", () => {});
const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve(code ?? signal)));
const memory = () => {
	try {
		const status = fs.readFileSync(`/proc/${child.pid}/status`, "utf8");
		const kb = (key) => Number(new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(status)?.[1]);
		return { vmSizeKB: kb("VmSize"), rssKB: kb("VmRSS") };
	} catch {
		return undefined;
	}
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await sleep(300);
const before = memory();
if (protocol === "jsonrpc") {
	child.stdin.write(`Content-Length: ${size}\r\n\r\n`);
} else {
	// [0x93, type 1 (request), bin8 "echo", bin32 <size>]: a 3-element array whose payload is a bin32 of <size> bytes.
	const header = Buffer.alloc(5);
	header[0] = 0xc6;
	header.writeUInt32BE(Number(size), 1);
	child.stdin.write(Buffer.concat([Buffer.from([0x93, 0x01, 0xc4, 4]), Buffer.from("echo"), header]));
}
await sleep(1500);
const after = memory();
child.stdin.end();
const status = await Promise.race([exited, sleep(10000).then(() => (child.kill(), "timeout"))]);
console.log(JSON.stringify({ protocol, size: String(size), before, after, status, stderr: stderr.split("\n").slice(0, 2).join(" | ") }));
