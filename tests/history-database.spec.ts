import {selectPreference} from './helpers/runtime-ui';
import { _electron as electron, expect, test } from "./helpers/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
const project = path.resolve(import.meta.dirname, ".."), work = path.resolve(project, "../../work");
async function setup(corrupt = false) {
  const data = await fs.mkdtemp(path.join(work, "history-database-ui-")),
    root = path.join(data, "示例知识库"),
    name = "旧文档.md",
    current = "# 当前内容\n\n```py {id=0001}\nprint(1)\n```\n",
    older = "# 旧版本\n\n原始内容\n",
    id = randomUUID();
  await fs.mkdir(path.join(root, "旧文档.assets/code-data/0001"), { recursive: true });
  await fs.mkdir(path.join(root, "旧文档.assets/attachments"), { recursive: true });
  await fs.mkdir(path.join(root, ".data"), { recursive: true });
  await fs.writeFile(
    path.join(data, "settings.json"),
    JSON.stringify({ version: 1, values: { "moyu-save-policy": "manual" } }),
  );
  await fs.writeFile(path.join(root, name), current);
  await fs.writeFile(path.join(root, "旧文档.assets/code-data/0001/input.txt"), "keep");
  const owner = JSON.stringify({ version: 2, document: name, nextId: 2, blocks: ["0001"] }, null, 2),
    map = JSON.stringify(
      { version: 2, documents: { [name]: { nextId: 2, blocks: ["0001"], directory: "旧文档.assets" } } },
      null,
      2,
    );
  await fs.writeFile(path.join(root, "旧文档.assets/document.json"), owner);
  await fs.writeFile(path.join(root, ".data/document_map.json"), map);
  const legacy = JSON.stringify({
    version: 1,
    entries: [{
      id,
      time: Date.now() - 1000,
      reason: "saved",
      bytes: Buffer.byteLength(older),
      data: gzipSync(older).toString("base64"),
    }],
  });
  if (corrupt) await fs.writeFile(path.join(root, ".data/history.sqlite"), "corrupt");
  else {
    await fs.mkdir(path.join(root, ".data/history", name), { recursive: true });
    await fs.writeFile(path.join(root, ".data/history", name, "versions.json"), legacy);
  }
  return { data, root, name, current, older, id, owner, map, legacy };
}
async function launch(data: string) {
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: "1", MOYU_DEMO: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(
      process.env.MOYU_E2E_EXECUTABLE
        ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env }
        : { args: [project], env },
    ),
    page = await app.firstWindow();
  await expect(page.locator('.tree-item[title="旧文档.md"]')).toBeVisible({ timeout: 30000 });
  await page.locator('.tree-item[title="旧文档.md"]').dblclick();
  await expect(page.locator(".ProseMirror")).toContainText("当前内容");
  return { app, page };
}

test("Native SQLite imports old history, keeps existing ownership files and data intact, and survives an application restart", async () => {
  const f = await setup();
  let running = await launch(f.data);
  try {
    const { page } = running;
    await page.getByRole("button", { name: "文档历史", exact: true }).click();
    await expect(page.locator(".history-entries button")).toHaveCount(1);
    await page.locator(".history-entries button").click();
    await expect(page.getByLabel("历史版本内容")).toContainText("旧版本");
    await expect(page.getByLabel("当前文档内容")).toContainText("当前内容");
    await page.screenshot({ path: path.join(work, "history-sqlite-v1819.png") });
    expect(await fs.readFile(path.join(f.root, ".data/history-legacy", f.name, "versions.json"), "utf8"))
      .toBe(f.legacy);
    expect(await fs.readFile(path.join(f.root, ".data/document_map.json"), "utf8")).toBe(f.map);
    expect(await fs.readFile(path.join(f.root, "旧文档.assets/document.json"), "utf8")).toBe(f.owner);
    expect(await fs.readFile(path.join(f.root, "旧文档.assets/code-data/0001/input.txt"), "utf8")).toBe(
      "keep",
    );
    const database = path.join(f.root, ".data/history.sqlite"),
      bytes = await fs.readFile(database),
      mtime = (await fs.stat(database)).mtimeMs;
    await page.waitForTimeout(1200);
    expect(await fs.readFile(database)).toEqual(bytes);
    expect((await fs.stat(database)).mtimeMs).toBe(mtime);
    await running.app.evaluate(({ app }) => app.exit(0));
    running = await launch(f.data);
    const list: any = await running.page.evaluate(
      name => window.moyu!.feature("file.history-list", { document: name }),
      f.name,
    );
    expect(list.ok).toBe(true);
    expect(list.data.entries).toHaveLength(1);
    expect(list.data.entries[0].id).toBe(f.id);
  } finally {
    await running.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test("Clearing history in data preferences preserves the archive file, code data and ownership metadata", async () => {
  const f = await setup(), { app, page } = await launch(f.data);
  try {
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    await selectPreference(page,"数据与运行环境");
    await page.locator('.data-group[aria-label="知识库文件"] > summary').click();
    await expect(page.locator('.data-group[aria-label="知识库文件"]')).toContainText("history.sqlite");
    await page.getByRole("button", { name: "删除数据 文档历史", exact: true }).click();
    await expect(page.getByText("清空文档历史？", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "确认清空", exact: true }).click();
    await expect(page.getByText("文档历史已清空", { exact: true })).toBeVisible();
    const list: any = await page.evaluate(
      name => window.moyu!.feature("file.history-list", { document: name }),
      f.name,
    );
    expect(list.ok).toBe(true);
    expect(list.data.entries).toHaveLength(0);
    expect((await fs.stat(path.join(f.root, ".data/history.sqlite"))).isFile()).toBe(true);
    expect(await fs.readFile(path.join(f.root, "旧文档.assets/document.json"), "utf8")).toBe(f.owner);
    expect(await fs.readFile(path.join(f.root, "旧文档.assets/code-data/0001/input.txt"), "utf8")).toBe(
      "keep",
    );
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test("An unavailable history database does not make the knowledge base read-only or prevent successful document saving", async () => {
  const f = await setup(true), { app, page } = await launch(f.data);
  try {
    const before: any = await page.evaluate(name => window.moyu!.read(name), f.name);
    const saved: any = await page.evaluate(
      d => window.moyu!.save(d.path, d.content + "\n新内容", d.version),
      before.data,
    );
    expect(saved.ok).toBe(true);
    expect(saved.data.historyWarning).toContain("文档已保存");
    expect(await fs.readFile(path.join(f.root, f.name), "utf8")).toContain("新内容");
    expect(await fs.readFile(path.join(f.root, ".data/history.sqlite"), "utf8")).toBe("corrupt");
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
