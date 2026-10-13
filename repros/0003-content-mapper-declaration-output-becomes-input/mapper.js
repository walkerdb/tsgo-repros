// Smallest tsgo content mapper: serves the file's text verbatim as TypeScript.
// Protocol: JSON-RPC 2.0 over stdio with LSP-style Content-Length framing.
let buf = Buffer.alloc(0);
process.stdin.on("data", chunk => {
	buf = Buffer.concat([buf, chunk]);
	for (;;) {
		const headerEnd = buf.indexOf("\r\n\r\n");
		if (headerEnd < 0) return;
		const length = Number(/Content-Length: *(\d+)/i.exec(buf.subarray(0, headerEnd).toString())[1]);
		if (buf.length < headerEnd + 4 + length) return;
		const msg = JSON.parse(buf.subarray(headerEnd + 4, headerEnd + 4 + length).toString());
		buf = buf.subarray(headerEnd + 4 + length);
		if (msg.id !== undefined) reply(msg.id, handle(msg.method, msg.params));
	}
});
function handle(method, params) {
	switch (method) {
		case "initialize": return { positionEncoding: "utf-8", diagnosticSource: "verbatim" };
		case "openProject": return {};
		case "closeProject": return null;
		case "transform": return { text: params.content, extension: ".ts" };
	}
	return null;
}
function reply(id, result) {
	const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, result }));
	process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
	process.stdout.write(body);
}
