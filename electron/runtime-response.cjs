const fs = require('node:fs');
const { stat } = require('node:fs/promises');
const { Readable } = require('node:stream');

// Keep large Wasm/SDK files out of the main process's temporary Buffer heap.
// The request signal also closes the file if its sandbox is stopped mid-load.
async function runtimeFileResponse(file, headers, signal) {
  const info = await stat(file);
  if (!info.isFile()) throw new Error('运行环境文件无效。');
  const source = fs.createReadStream(file, { signal });
  return new Response(Readable.toWeb(source), {
    headers: { ...headers, 'Content-Length': String(info.size) },
  });
}
module.exports = { runtimeFileResponse };
