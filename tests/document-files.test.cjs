const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { Vault } = require("../electron/vault.cjs"),
  { Attachments } = require("../electron/attachments.cjs"),
  { References } = require("../electron/references.cjs"),
  { CodeData } = require("../electron/code-data.cjs"),
  { DocumentFiles } = require("../electron/document-files.cjs");
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moyu-document-")),
    vault = await new Vault(root).init(),
    attachments = new Attachments(vault),
    refs = new References(vault),
    data = new CodeData(vault, attachments, refs);
  const operations = new DocumentFiles(
    vault,
    attachments,
    refs,
    p => fs.rename(p, path.join(root, "trashed-" + path.basename(p))),
  );
  t.after(async () => {
    const actual = path.resolve(root);
    assert(actual.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(actual, { recursive: true, force: true });
  });
  return { root, vault, attachments, refs, data, operations };
}

test("Explorer dates and ownership distinguish ordinary assets folders, and companion names preserve full stems", async t => {
  const { vault, attachments, root } = await fixture(t);
  await vault.create('目录', 'folder');
  await vault.create('目录/笔记.v2.MD', 'file', 'note');
  await vault.create('普通.assets', 'folder');
  assert.equal(attachments.documents.root('目录/笔记.v2.MD'), '目录/笔记.v2.assets');
  assert.equal(attachments.documents.root('其他.markdown'), '其他.assets');
  await attachments.upload({document:'目录/笔记.v2.MD',name:'图.svg',bytes:Buffer.from('<svg/>')});
  const tree=(await vault.list()).tree, folder=tree.find(n=>n.path==='目录'), owned=folder.children.find(n=>n.path==='目录/笔记.v2.assets');
  assert.equal(owned.companionFor,'目录/笔记.v2.MD');
  assert.equal(tree.find(n=>n.path==='普通.assets').companionFor,undefined);
  for(const node of [folder,owned,folder.children.find(n=>n.kind==='file')]) {assert.equal(typeof node.updated,'number');assert.equal(typeof node.created,'number');}
  assert.equal(await fs.stat(path.join(root,'attachments')).catch(()=>null),null);
});
test("IDs are document scoped, monotonic, duplicate-safe and preserve metadata order", async () => {
  const { normalizeIds } = await import("../shared/code-documents.mjs");
  let result = normalizeIds("```python {height=160 size=50%}\n1\n```\n\n```sql\nselect 1\n```");
  assert.match(result.content, /height=160 size=50% id=0001/);
  assert.equal(result.next, 3);
  result = normalizeIds("```python\n2\n```", result.next);
  assert.match(result.content, /id=0003/);
  const duplicate = normalizeIds("```js {id=0001}\n1\n```\n```js {id=0001}\n1\n```");
  assert.match(duplicate.content, /id=0002/);
  const exhausted = normalizeIds("```js\n1\n```", 65536);
  assert.equal(exhausted.exhausted, true);
  assert.equal(exhausted.content, "```js\n1\n```");
});

test("Read-only counter and data queries do not allocate IDs, rewrite documents or persist draft association", async t => {
  const { vault, attachments, data, root } = await fixture(t);
  const doc = await vault.create("只读.md", "file", "```js\nconsole.log(1)\n```");
  assert.deepEqual(await attachments.documents.counter(doc.path), { next: 1 });
  assert.deepEqual(await data.list({ document: doc.path, content: doc.content }), []);
  assert.equal(
    await fs.stat(path.join(root, ".data/document_map.json")).catch(() => null),
    null,
  );
  assert.equal((await vault.read(doc.path)).content, doc.content);
  const saved = await vault.save(doc.path, "```js {id=0001}\nconsole.log(1)\n```", doc.version);
  await attachments.documents.sync(doc.path, saved.content);
  await data.upload({
    document: doc.path,
    language: "js",
    id: "0001",
    name: "a.txt",
    bytes: Buffer.from("a"),
  });
  const file = path.join(root, ".data/document_map.json"),
    before = await fs.readFile(file, "utf8");
  assert.equal((await data.list({ document: doc.path, content: "" }))[0].associated, false);
  assert.equal((await data.list({ document: doc.path }))[0].associated, true);
  assert.equal(await fs.readFile(file, "utf8"), before);
  const r = JSON.parse(before).documents[doc.path];
  assert.deepEqual(r, { directory: "只读.assets" });
  assert.deepEqual((await attachments.documents.read(doc.path)).documents[doc.path], { nextId: 2, blocks: ["0001"], directory: "只读.assets" });
});
test("Deleted blocks retain unassociated data and can rebind without ordinal guessing", async t => {
  const { vault, data, attachments, root } = await fixture(t);
  let content = "```python {id=0001}\nprint(1)\n```\n\n```python {id=0002}\nprint(2)\n```";
  await vault.create("测试.md", "file", content);
  await attachments.documents.sync("测试.md", content);
  await data.upload({
    document: "测试.md",
    language: "py",
    id: "0001",
    name: "数据.txt",
    bytes: Buffer.from("first"),
  });
  content = "```python {id=0002}\nprint(2)\n```";
  let groups = await data.list({ document: "测试.md", content });
  assert.equal(groups[0].associated, false);
  assert.equal(groups[0].key, "0001");
  await data.rebind({
    document: "测试.md",
    content,
    key: "0001",
    language: "py",
    id: "0002",
  });
  groups = await data.list({ document: "测试.md", content });
  assert.equal(groups[0].associated, true);
  assert.equal(groups[0].key, "0002");
  assert.equal(await fs.readFile(path.join(root, groups[0].path, "数据.txt"), "utf8"), "first");
  assert.equal(await fs.stat(path.join(root, ".data/代码数据.json")).catch(() => null), null);
});
test("Document rename and copy move bound folders and rewrite links across all referencing notes", async t => {
  const { vault, attachments, operations, root } = await fixture(t);
  await vault.create("目录", "folder");
  const original = await vault.create("目录/测试.md", "file", "```python {id=0001}\n1\n```");
  await attachments.documents.sync(original.path, original.content);
  const asset = await attachments.upload({
    document: original.path,
    name: "图.png",
    bytes: Buffer.from("image"),
  });
  await vault.save(
    original.path,
    "![图](" + asset.link + ")\n" + original.content,
    original.version,
  );
  await vault.create("其他.md", "file", "![共享](目录/测试.assets/attachments/图.png)");
  await operations.rename({ from: original.path, to: "另一个/新名.md" });
  assert.match((await vault.read("其他.md")).content, /另一个\/新名\.assets/);
  assert.equal(await fs.readFile(path.join(root, "另一个/新名.assets/attachments/图.png"), "utf8"), "image");
  await operations.copy({ from: "另一个/新名.md", to: "复制.md" });
  assert.match((await vault.read("复制.md")).content, /复制\.assets\/attachments\/图.png/);
  assert.match((await vault.read("复制.md")).content, /id=0001/);
  assert.equal(await fs.readFile(path.join(root, "复制.assets/attachments/图.png"), "utf8"), "image");
});

test("Copying a parent folder duplicates ownership while keeping external attachments external", async t => {
  const {vault, attachments, operations, root}=await fixture(t);
  await vault.create('目录','folder');await vault.create('目录/子','folder');
  await fs.writeFile(path.join(root,'共享.svg'),'<svg/>');
  const original=await vault.create('目录/子/笔记.md','file','```py {id=0001}\n42\n```');
  const image=await attachments.upload({document:original.path,name:'图.svg',bytes:Buffer.from('<svg/>')});
  await vault.save(original.path,original.content+'\n![图]('+image.link+')\n[外部](../../共享.svg)',original.version);
  await operations.copy({from:'目录',to:'目录副本'});
  const copied=await vault.read('目录副本/子/笔记.md');
  assert.match(copied.content,/笔记\.assets\/attachments\/图.svg/);assert.match(copied.content,/\.\.\/\.\.\/共享.svg/);
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'目录副本/子/笔记.assets/document.json'),'utf8')).document,'目录副本/子/笔记.md');
  const registry=await attachments.documents.read();assert.equal(registry.documents[copied.path].directory,'目录副本/子/笔记.assets');assert.equal(registry.documents[original.path].directory,'目录/子/笔记.assets');
  assert.deepEqual(await operations.orphans(),[]);
});

test("Notes with the same stem cannot reuse or overwrite another document's companion directory",async t=>{
 const {vault,attachments,root}=await fixture(t);await vault.create('笔记.md','file','note');await vault.create('笔记.markdown','file','other');
 const image=await attachments.upload({document:'笔记.md',name:'图.txt',bytes:Buffer.from('original')});
 await assert.rejects(attachments.upload({document:'笔记.markdown',name:'图.txt',bytes:Buffer.from('changed')}),/同名|已关联/);
 assert.equal(await fs.readFile(path.join(root,image.path),'utf8'),'original');
});
test("Shared attachment deletion transfers separately to each referencing document", async t => {
  const { vault, attachments, operations, root } = await fixture(t);
  await vault.create("原.md", "file", "原文");
  const asset = await attachments.upload({
    document: "原.md",
    name: "图.png",
    bytes: Buffer.from("image"),
  });
  await vault.create("甲.md", "file", "![a](" + asset.link + ")");
  await vault.create("乙.md", "file", "![b](" + asset.link + ")");
  const impact = await operations.impact({ path: "原.md" });
  assert.equal(impact.affected.length, 2);
  await operations.remove({ path: "原.md", transfer: true });
  for (const doc of ["甲", "乙"]) {
    assert.match(
      (await vault.read(doc + ".md")).content,
      new RegExp(doc + "\\.assets/attachments/图.png"),
    );
    assert.equal(await fs.readFile(path.join(root, doc + ".assets", "attachments/图.png"), "utf8"), "image");
  }
  assert.equal(await fs.stat(path.join(root, "原.md")).catch(() => null), null);
  assert.equal(await fs.stat(path.join(root, "原.assets")).catch(() => null), null);
});
test("SQL_GLOBAL remains when SQL blocks are removed and document removal deletes it", async t => {
  const { vault, data, operations, root } = await fixture(t);
  const content = "```sql {id=0001}\nselect 1\n```";
  await vault.create("共享.md", "file", content);
  const context = await data.context({
    document: "共享.md",
    language: "sql",
    id: "0001",
    scope: "global",
    markdown: content,
  });
  assert.match(context.directory, /共享\.assets\/code-data\/SQL_GLOBAL$/);
  const groups = await data.list({ document: "共享.md", content: "" });
  assert.equal(groups[0].global, true);
  assert.equal(groups[0].associated, true);
  await operations.remove({ path: "共享.md" });
  assert.equal(await fs.stat(path.join(root, context.directory)).catch(() => null), null);
});
test("External rename finds only matching candidates and reassociation repairs relative links", async t => {
  const { vault, attachments, operations, root } = await fixture(t);
  const original = await vault.create("旧.md", "file", "```py {id=0001}\n42\n```");
  await attachments.documents.sync(original.path, original.content);
  const asset = await attachments.upload({
    document: "旧.md",
    name: "图.png",
    bytes: Buffer.from("image"),
  });
  const saved = await vault.save(
    "旧.md",
    original.content + "\n![图](" + asset.link + ")",
    original.version,
  );
  await attachments.documents.sync("旧.md", saved.content);
  await fs.mkdir(path.join(root, "新"));
  await fs.rename(path.join(root, "旧.md"), path.join(root, "新/改名.md"));
  await vault.create("无关.md", "file", "text");
  const orphans = await operations.orphans();
  assert.deepEqual(orphans[0].candidates, ["新/改名.md"]);
  await operations.associate({ document: "旧.md", target: "新/改名.md" });
  assert.match((await vault.read("新/改名.md")).content, /改名\.assets\/attachments/);
  assert.equal((await operations.orphans()).length, 0);
});
test("Trash failure restores document, attached data and rewritten shared links", async t => {
  const { vault, attachments, operations, root } = await fixture(t);
  await vault.create("原.md", "file", "original");
  const asset = await attachments.upload({
    document: "原.md",
    name: "a.png",
    bytes: Buffer.from("image"),
  });
  const other = await vault.create("引用.md", "file", "![a](" + asset.link + ")");
  operations.trashItem = async () => {
    throw new Error("trash failed");
  };
  await assert.rejects(operations.remove({ path: "原.md", transfer: true }), /trash failed/);
  assert.equal((await vault.read("引用.md")).content, other.content);
  assert.equal((await vault.read("原.md")).content, "original");
  assert.equal(await fs.readFile(path.join(root, asset.path), "utf8"), "image");
});
test("Adjacent folders move with their parent; external parent moves are discovered from visible ownership records", async t => {
  const { vault, attachments, operations, root } = await fixture(t);
  await vault.create("旧目录", "folder");
  const original = await vault.create("旧目录/笔记.md", "file", "```py {id=0001}\n42\n```");
  await attachments.documents.sync(original.path, original.content);
  const image = await attachments.upload({
    document: original.path,
    name: "图.png",
    bytes: Buffer.from("image"),
  });
  const saved = await vault.save(
    original.path,
    original.content + "\n![图](" + image.link + ")",
    original.version,
  );
  await attachments.documents.sync(original.path, saved.content);
  await operations.rename({ from: "旧目录", to: "新目录" });
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, "新目录/笔记.assets/document.json"), "utf8")).document,
    "新目录/笔记.md",
  );
  await fs.rename(path.join(root, "新目录"), path.join(root, "外部移动"));
  await attachments.documents.discover();
  const orphan = (await operations.orphans())[0];
  assert.equal(orphan.directory, "外部移动/笔记.assets");
  assert.deepEqual(orphan.candidates, ["外部移动/笔记.md"]);
  await operations.associate({ document: orphan.document, target: orphan.candidates[0] });
  assert.match((await vault.read("外部移动/笔记.md")).content, /笔记\.assets\/attachments\/图.png/);
  assert.equal((await operations.orphans()).length, 0);
});
test("Counter deletion and restart recover ownership from the document folder without merging unknown user folders", async t => {
  const { vault, attachments, root } = await fixture(t);
  await vault.create("测试.md", "file", "```py {id=0001}\n42\n```");
  await attachments.documents.sync("测试.md", (await vault.read("测试.md")).content);
  await attachments.upload({ document: "测试.md", name: "图.png", bytes: Buffer.from("image") });
  await fs.unlink(path.join(root, ".data/document_map.json"));
  await attachments.documents.discover();
  const map = await attachments.documents.read();
  assert.equal(map.documents["测试.md"].directory, "测试.assets");
  await vault.create("冲突.md", "file", "text");
  await fs.mkdir(path.join(root, "冲突.assets"));
  await assert.rejects(
    attachments.upload({ document: "冲突.md", name: "a.png", bytes: Buffer.from("a") }),
    /同名文件夹/,
  );
});
test("Fences typed without a newline remain drafts; IDs normalize correctly inside nested lists and block quotes", async () => {
  const { normalizeIds, parseBlocks } = await import("../shared/code-documents.mjs");
  assert.equal(normalizeIds("```python").content, "```python");
  const value = "- text\n\n  ```py {height=100}\n  print(1)\n  ```\n\n> ```sql\n> SELECT 1;\n> ```";
  const normalized = normalizeIds(value);
  assert.deepEqual(parseBlocks(normalized.content).map(b => b.id), ["0001", "0002"]);
  assert.match(normalized.content, /  ```py \{height=100 id=0001\}/);
  assert.equal(normalizeIds(normalized.content).content, normalized.content);
});

test("Retained document SQL data remains editable after its last block is deleted", async t => {
  const { vault, data } = await fixture(t);
  const original = await vault.create(
    "文档.md",
    "file",
    "```sql {id=0001}\nSELECT 1;\n```",
  );
  await data.context({
    document: original.path,
    language: "sql",
    id: "0001",
    scope: "global",
    markdown: original.content,
  });
  await vault.save(original.path, "text", original.version);
  await data.list({ document: original.path, content: "text" });
  await data.upload({
    document: original.path,
    language: "sql",
    id: "GLOBAL",
    scope: "global",
    name: "说明.txt",
    bytes: Buffer.from("retained"),
  });
  const groups = await data.list({ document: original.path });
  assert.equal(groups[0].key, "SQL_GLOBAL");
  assert.equal(groups[0].associated, true);
  assert.equal(groups[0].files[0].name, "说明.txt");
  await data.remove({
    document: original.path,
    language: "sql",
    id: "GLOBAL",
    scope: "global",
    name: "说明.txt",
  });
  assert.equal((await data.list({ document: original.path }))[0].files.length, 0);
});

test("Downloaded ownership records preserve the highest reserved code ID without a restart", async t => {
  const { vault, attachments, root } = await fixture(t);
  await vault.create("同步.md", "file", "```py {id=0001}\n42\n```");
  await attachments.documents.sync("同步.md", (await vault.read("同步.md")).content);
  await attachments.upload({ document: "同步.md", name: "a.txt", bytes: Buffer.from("a") });
  const file = path.join(root, "同步.assets/document.json"),
    owner = JSON.parse(await fs.readFile(file, "utf8"));
  owner.nextId = 16;
  await fs.writeFile(file, JSON.stringify(owner));
  await attachments.documents.discover();
  const normalized = await attachments.documents.sync("同步.md", "```py\n43\n```");
  assert.match(normalized.content, /id=0010/);
  assert.equal(JSON.parse(await fs.readFile(file, "utf8")).nextId, 17);
});

test("Unlabelled fences and attribute-only headers retain one stable ID on every round trip", async () => {
  const { normalizeIds, parseBlocks } = await import("../shared/code-documents.mjs");
  for (const source of ["```\nplain\n```", "``` {height=160 id=0001}\nplain\n```"]) {
    const first = normalizeIds(source), second = normalizeIds(first.content, first.next);
    assert.equal(second.content, first.content);
    assert.equal(second.next, first.next);
    const blocks = parseBlocks(first.content);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].language, "text");
    assert.equal(blocks[0].id, "0001");
  }
});

test("Plain notes still match after copy or shared-attachment transfer rewrites relative URLs", async t => {
  const { vault, attachments, operations, root } = await fixture(t);
  const original = await vault.create("原.md", "file", "A note");
  const image = await attachments.upload({
    document: original.path,
    name: "图.png",
    bytes: Buffer.from("image"),
  });
  const saved = await vault.save(
    original.path,
    "A note\n![图](" + image.link + ")",
    original.version,
  );
  await attachments.documents.sync(original.path, saved.content);
  await operations.copy({ from: "原.md", to: "复制.md" });
  await fs.rename(path.join(root, "复制.md"), path.join(root, "外部.md"));
  let orphan = (await operations.orphans()).find(o => o.document === "复制.md");
  assert.deepEqual(orphan.candidates, ["外部.md"]);
  await operations.associate({ document: "复制.md", target: "外部.md" });
  await vault.create("引用.md", "file", "Referenced note\n![图](" + image.link + ")");
  await operations.remove({ path: "原.md", transfer: true });
  await fs.rename(path.join(root, "引用.md"), path.join(root, "改名.md"));
  orphan = (await operations.orphans()).find(o => o.document === "引用.md");
  assert.deepEqual(orphan.candidates, ["改名.md"]);
});

test("Ownership stores only IDs and paths; owned links identify renamed notes without confusing unrelated IDs", async t => {
  const { vault, attachments, operations, root } = await fixture(t);
  const source = await vault.create("原.md", "file", "```py {id=0001}\nprint(1)\n```");
  await attachments.documents.sync(source.path, source.content);
  const attached=await attachments.upload({ document: source.path, name: "a.txt", bytes: Buffer.from("data") });
  await vault.save(source.path,source.content+'\n[数据]('+attached.link+')',source.version);
  for (const name of [".data/document_map.json", "原.assets/document.json"]) {
    const body = await fs.readFile(path.join(root, name), "utf8");
    assert.doesNotMatch(body, /hash|fingerprint|print\(1\)/i);
    if(name.endsWith('/document.json'))assert.match(body, /0001/);
    else assert.deepEqual(JSON.parse(body).documents['原.md'],{directory:'原.assets'});
  }
  await fs.rename(path.join(root, "原.md"), path.join(root, "改名.md"));
  const renamed = await vault.read("改名.md");
  await vault.save(renamed.path, renamed.content.replace("print(1)", "print(2)"), renamed.version);
  await vault.create("其他语言.md", "file", "```sql {id=0001}\nselect 1\n```");
  await vault.create("其他ID.md", "file", "```py {id=0002}\nprint(1)\n```");
  assert.deepEqual((await operations.orphans())[0].candidates, ["改名.md"]);
});

test("Index writes remove obsolete ownership fields and normal startup skips candidate document scans", async t => {
  const { vault, attachments, operations, root } = await fixture(t);
  const doc = await vault.create("测试.md", "file", "```py {id=0001}\n1\n```");
  await attachments.documents.sync(doc.path, doc.content);
  await attachments.upload({ document: doc.path, name: "a.txt", bytes: Buffer.from("a") });
  const registryPath = path.join(root, ".data/document_map.json");
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
  Object.assign(registry.documents[doc.path], {
    hash: "obsolete",
    savedHash: "obsolete",
    fingerprint: "obsolete",
  });
  registry.version = 1;
  registry.documents[doc.path].blocks = {"0001": {
    language: "Python",
    active: true,
    scope: "block",
    codeHash: "obsolete",
  }};
  await fs.writeFile(registryPath, JSON.stringify(registry));
  await attachments.documents.discover();
  for (const name of [".data/document_map.json", "测试.assets/document.json"]) {
    assert.doesNotMatch(
      await fs.readFile(path.join(root, name), "utf8"),
      /hash|fingerprint|active|savedBlocks|created|scope/i,
    );
  }
  vault.read = async () => {
    throw Error("Unexpected candidate scan");
  };
  assert.deepEqual(await operations.orphans(), []);
});

test("Changing a valid code ID retains the former directory as unassociated until an explicit rebind", async t => {
  const { vault, attachments, data, root } = await fixture(t);
  const original = await vault.create("改ID.md", "file", "```py {id=0001}\nprint(1)\n```");
  await attachments.documents.sync(original.path, original.content);
  await data.upload({
    document: original.path,
    language: "py",
    id: "0001",
    name: "input.txt",
    bytes: Buffer.from("data"),
  });
  const saved = await vault.save(
    original.path,
    original.content.replace("id=0001", "id=00aa"),
    original.version,
  );
  await attachments.documents.sync(saved.path, saved.content);
  const groups = await data.list({ document: saved.path, content: saved.content });
  assert.equal(groups[0].key, "0001");
  assert.equal(groups[0].associated, false);
  assert.equal(await fs.readFile(path.join(root, groups[0].path, "input.txt"), "utf8"), "data");
  await data.rebind({
    document: saved.path,
    content: saved.content,
    key: "0001",
    language: "py",
    id: "00aa",
  });
  const rebound = await data.list({ document: saved.path, content: saved.content });
  assert.equal(rebound[0].key, "00aa");
  assert.equal(rebound[0].associated, true);
});

test("Code data follows a fixed document-local ID across saved and unsaved language changes", async t => {
  const { vault, attachments, data, root } = await fixture(t);
  const doc = await vault.create("语言.md", "file", "```py {id=0001}\nprint(1)\n```");
  await attachments.documents.sync(doc.path, doc.content);
  const input = { document: doc.path, language: "py", id: "0001" };
  await data.upload({ ...input, name: "input.txt", bytes: Buffer.from("same data") });
  const filename = path.join(root, "语言.assets/code-data/0001/input.txt");
  const before = await fs.stat(filename);
  const changed = doc.content.replace("```py", "```js");
  const groups = await data.list({ document: doc.path, content: changed });
  assert.deepEqual(groups.map(g => [g.key, g.id, g.language, g.associated]), [["0001", "0001", "JavaScript", true]]);
  assert.equal((await vault.read(doc.path)).content, doc.content);
  const context = await data.context({ ...input, language: "js", markdown: changed });
  assert.equal(context.directory, "语言.assets/code-data/0001");
  assert.equal(Buffer.from(context.files[0].data, "base64").toString(), "same data");
  await assert.rejects(data.context({ ...input, language: "py", markdown: changed }), /代码块已改变/);
  const saved = await vault.save(doc.path, changed, doc.version);
  await attachments.documents.sync(doc.path, saved.content);
  assert.equal((await data.list({ document: doc.path }))[0].language, "JavaScript");
  assert.equal((await fs.stat(filename)).mtimeMs, before.mtimeMs);
  await data.persist({ ...input, language: "js" }, context, [{ name: "input.txt", data: Buffer.from("updated").toString("base64") }]);
  assert.equal(await fs.readFile(filename, "utf8"), "updated");
  const text = changed.replace("```js", "```text");
  const nonRunnable = (await data.list({ document: doc.path, content: text }))[0];
  assert.equal(nonRunnable.associated, true);
  assert.equal(nonRunnable.language, "text");
  await data.upload({ ...input, language: "text", content: text, name: "extra.txt", bytes: Buffer.from("extra") });
  await vault.create("另一个.md", "file", "```js {id=0001}\n1\n```");
  assert.equal((await data.context({ document: "另一个.md", language: "js", id: "0001", scope: "global" })).files.length, 0);
  assert.equal(await fs.stat(path.join(root, "另一个.assets")).catch(() => null), null);
});

test("ID directories can rebind across languages and cannot overwrite another block's data", async t => {
  const { vault, attachments, data, root } = await fixture(t);
  const doc = await vault.create("关联.md", "file", "```py {id=0001}\n1\n```\n\n```js {id=0002}\n2\n```\n\n```c {id=0003}\n3\n```");
  await attachments.documents.sync(doc.path, doc.content);
  await data.upload({ document: doc.path, language: "py", id: "0001", name: "keep.txt", bytes: Buffer.from("keep") });
  await data.upload({ document: doc.path, language: "js", id: "0002", name: "other.txt", bytes: Buffer.from("other") });
  const content = doc.content.replace("```py {id=0001}\n1\n```", "");
  await assert.rejects(data.rebind({ document: doc.path, content, key: "0001", id: "0002", language: "js" }), /名称已经存在/);
  await data.rebind({ document: doc.path, content, key: "0001", id: "0003", language: "c" });
  const groups = await data.list({ document: doc.path, content });
  assert.equal(groups.find(g => g.key === "0003").language, "C");
  assert.equal(await fs.readFile(path.join(root, "关联.assets/code-data/0003/keep.txt"), "utf8"), "keep");
  assert.equal(await fs.readFile(path.join(root, "关联.assets/code-data/0002/other.txt"), "utf8"), "other");
});

test("Old language-prefixed directories adopt IDs with references; ambiguous or occupied IDs stay intact", async t => {
  const { vault, attachments, data, root } = await fixture(t);
  const doc = await vault.create("旧目录.md", "file", "```js {id=0001}\n1\n```\n\n[数据](旧目录.assets/code-data/Python_0001/input.txt)");
  await attachments.documents.sync(doc.path, doc.content);
  const folder = await attachments.documents.ensureUnlocked(doc.path);
  const create = async (name, text) => {
    const directory = path.join(root, folder, "code-data", name);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "input.txt"), text);
  };
  await create("Python_0001", "first");
  await create("Python_0002", "python");
  await create("JavaScript_0002", "javascript");
  await create("0003", "id");
  await create("Lua_0003", "lua");
  await create("SQL_GLOBAL", "global");
  assert.equal(await data.migrateDirectories(), 1);
  assert.match((await vault.read(doc.path)).content, /code-data\/0001\/input.txt/);
  assert.equal(await fs.readFile(path.join(root, folder, "code-data/0001/input.txt"), "utf8"), "first");
  const groups = await data.list({ document: doc.path });
  assert.equal(groups.find(g => g.key === "0001").language, "JavaScript");
  for (const key of ["Python_0002", "JavaScript_0002", "Lua_0003"]) assert.equal(groups.find(g => g.key === key).associated, false);
  assert.equal(groups.find(g => g.key === "SQL_GLOBAL").associated, true);
  assert.equal(await data.migrateDirectories(), 0);
  await data.rebind({ document: doc.path, content: "```c {id=0004}\n4\n```", key: "Python_0002", language: "c", id: "0004" });
  assert.equal(await fs.readFile(path.join(root, folder, "code-data/0004/input.txt"), "utf8"), "python");
  assert.equal(await fs.readFile(path.join(root, folder, "code-data/JavaScript_0002/input.txt"), "utf8"), "javascript");
});
