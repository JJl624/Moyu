const { test } = require("node:test"), assert = require("node:assert/strict");
const { responseBytes } = require("../electron/npm-store.cjs");
test("Transient HTTP failures retry within a bound while ordinary missing files fail immediately", async t => {
  const previous = global.fetch;
  t.after(() => global.fetch = previous);
  let count = 0;
  global.fetch = async () =>
    ++count < 3 ? new Response("busy", { status: 503, headers: { "retry-after": "0.001" } }) : new Response("ready");
  assert.equal((await responseBytes("https://example.com/runtime.wasm", 20)).toString(), "ready");
  assert.equal(count, 3);
  count = 0;
  global.fetch = async () => {
    count++;
    return new Response("missing", { status: 404 });
  };
  await assert.rejects(responseBytes("https://example.com/missing.wasm", 20), /404/);
  assert.equal(count, 1);
});
test("A retry delay can be cancelled without sending another download request", async t => {
  const previous = global.fetch;
  t.after(() => global.fetch = previous);
  const controller = new AbortController();
  let count = 0;
  const job = {
    controller,
    check() {
      if (controller.signal.aborted) throw Object.assign(Error("已取消"), { code: "DOWNLOAD_CANCELLED" });
    },
  };
  global.fetch = async () => {
    count++;
    return new Response("busy", { status: 503 });
  };
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(
    responseBytes("https://example.com/runtime.wasm", 20, undefined, job),
    error => error.code === "DOWNLOAD_CANCELLED",
  );
  assert.equal(count, 1);
});
