const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const { Vault } = require("../electron/vault.cjs"),
  { Attachments } = require("../electron/attachments.cjs"),
  { CodeData } = require("../electron/code-data.cjs");
async function fixture(t) {
  const root = await fs.mkdtemp(path.resolve(__dirname, "../../../work/data-create-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const vault = await new Vault(root).init(),
    attachments = new Attachments(vault),
    data = new CodeData(vault, attachments);
  const content = "```js {id=0001}\nconsole.log(42)\n```\n\n```sql {id=0002}\nSELECT 42;\n```";
  await vault.create("Note.md", "file", content);
  return { root, vault, data, input: { document: "Note.md", content, language: "js", id: "0001" } };
}
test("Empty data files use the stable block folder, reject paths and duplicates, and keep the Markdown unchanged", async t => {
  const { root, vault, data, input } = await fixture(t);
  const created = await data.create({ ...input, name: "input.json" });
  assert.match(created.path, /code-data\/0001\/input.json$/);
  assert.equal((await fs.readFile(path.join(root, created.path))).length, 0);
  await fs.writeFile(path.join(root, created.path), "keep");
  await assert.rejects(data.create({ ...input, name: "input.json" }), { code: "EEXIST" });
  assert.equal(await fs.readFile(path.join(root, created.path), "utf8"), "keep");
  for (const name of ["../escape.txt", "sub/file.txt", "C:\\outside.txt", "bad?.txt"]) {
    await assert.rejects(data.create({ ...input, name }));
  }
  assert.equal((await vault.read("Note.md")).content, input.content);
});
test("Empty file creation supports retained unassociated data and the document-wide SQL folder without mixing their identities", async t => {
  const { root, data, input } = await fixture(t);
  const global = await data.create({
    ...input,
    language: "sql",
    id: "0002",
    scope: "global",
    name: "setup.sql",
  });
  assert.match(global.path, /SQL_GLOBAL\/setup.sql$/);
  const orphan = await data.create({ ...input, content: "plain text", language: "", name: "retained.txt" });
  assert.match(orphan.path, /code-data\/0001\/retained.txt$/);
  assert.equal((await fs.stat(path.join(root, global.path))).size, 0);
  assert.equal((await fs.stat(path.join(root, orphan.path))).size, 0);
});
