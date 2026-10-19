import { _electron as electron, expect, test } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";
import { parseBlocks } from "../shared/code-documents.mjs";
import {seedRuntimeCache} from './helpers/runtime-cache';
const project = path.resolve(import.meta.dirname, "..");
test("Every runnable guide block executes with its seeded inputs; shared SQL, tables, images and files stay consistent", async () => {
  test.setTimeout(300000);
  const base = path.resolve(project, "../../work/e2e");
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, "guide-runtime-"));
  await seedRuntimeCache(data);
  if (process.env.MOYU_TEST_PYTHON_CACHE) {
    await fs.cp(process.env.MOYU_TEST_PYTHON_CACHE, path.join(data, "Python"), { recursive: true });
  }
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: "1", MOYU_TEST_OFFSCREEN: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MOYU_DEMO;
  const app = await electron.launch({
    ...process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [] }
      : { args: [project] },
    env,
  });
  try {
    const page = await app.firstWindow(), errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await expect(page.getByRole("region", { name: "知识库导航" })).toBeVisible();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, data);
    await page.getByLabel("知识库名称", { exact: true }).fill("运行示例");
    await page.getByRole("button", { name: "选择位置并创建", exact: true }).click();
    await expect(page.locator(".ProseMirror h1")).toBeVisible();
    const root = path.join(data, "运行示例"),
      document = "公式和代码示例.md",
      markdown = await fs.readFile(path.join(root, document), "utf8");
    const blocks = parseBlocks(markdown).filter(b =>
      /^(python|javascript|typescript|c|cpp|sql|lua|cs|csharp|java|ruby|rb|bash|sh)$/.test(b.language)
    );
    expect(blocks.length).toBe(36);
    let executed = 0;
    for (const block of blocks) {
      const global = block.language === "sql" && (block.id === "0019" || block.id === "001a");
      if (block.code.includes("matplotlib") && !process.env.MOYU_TEST_PYTHON_CACHE) continue;
      const r: any = await page.evaluate(input => window.moyu!.feature("code.run", input), {
        document,
        markdown,
        ...block,
        scope: global ? "global" : "block",
        mode:block.code.includes('document.body.innerHTML')?'dom':'worker',
      });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r.data.error, block.id + ": " + r.data.error).toBe("");
      executed++;
      if (block.code.includes("from helper import")) {
        expect(r.data.output).toBe("40\n");
        const a = r.data.artifacts.find((a: any) => a.kind === "table");
        expect(a.rowCount).toBe(120);
        const last: any = await page.evaluate(
          token => window.moyu!.feature("code.result-page", { token, page: 2 }),
          a.token,
        );
        expect(last.data.rows).toHaveLength(20);
      }
      if (block.code.includes("values' in globals")) expect(r.data.output).toBe("False\n");
      if (
        block.code.includes("util.h") || block.code.includes("helper.hpp")
        || block.code.includes("require('calc')")
      ) expect(r.data.output).toContain("42");
      if (global) {
        const a = r.data.artifacts.find((a: any) => a.kind === "table");
        const rows: any = await page.evaluate(
          token => window.moyu!.feature("code.result-page", { token, page: 0 }),
          a.token,
        );
        expect(rows.data.rows.length).toBe(block.code.includes("BEGIN") ? 3 : 2);
      }
      if (block.code.includes("plt.show")) {
        expect(r.data.artifacts.some((a: any) => a.kind === "image" && a.token && !a.data)).toBe(
          true,
        );
      }
      await page.evaluate(
        tokens => window.moyu!.feature("code.result-release", { tokens }),
        r.data.artifacts.map((a: any) => a.token),
      );
    }
    expect(executed).toBe(process.env.MOYU_TEST_PYTHON_CACHE ? 36 : 35);
    expect(await fs.readFile(path.join(root, document), "utf8")).toBe(markdown);
    const state: any = await page.evaluate(
      document => window.moyu!.feature("code.data-list", { document }),
      document,
    );
    expect(state.ok).toBe(true);
    expect(state.data.some((g: any) => g.key === "SQL_GLOBAL")).toBe(true);
    expect(
      await fs.readFile(
        path.join(root, "公式和代码示例.assets/code-data/0017/output/result.txt"),
        "utf8",
      ),
    ).toBe("42\n");
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
