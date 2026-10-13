// usage: node write-pieces.js <file> <pauseMs> <nChunks> <text>
// Truncates the file, then writes <text> in <nChunks> pieces with <pauseMs> pauses before each piece.
const fs = require("fs");
const [file, pauseMs, nChunks, text] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4]), process.argv[5]];
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const fd = fs.openSync(file, "w");
const size = Math.ceil(text.length / nChunks);
for (let i = 0; i < nChunks; i++) {
	sleep(pauseMs);
	fs.writeSync(fd, text.slice(i * size, (i + 1) * size));
}
fs.closeSync(fd);
