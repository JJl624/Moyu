import { test, expect, _electron as electron } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const project = path.resolve(import.meta.dirname, "..");
const parser = unified().use(remarkParse).use(remarkGfm);
test("Heading, code, table and task remain one list item when indenting and round-tripping", async () => {
  const work = path.resolve(project, "../../work/e2e");
  await fs.mkdir(work, { recursive: true });
  const directory = await fs.mkdtemp(path.join(work, "lists-"));
  const env = { ...process.env, MOYU_USER_DATA: directory, MOYU_TEST: "1", MOYU_DEMO: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [project], env });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.locator(".ProseMirror h1")).toBeVisible();
    await expect(page.locator(".right-sidebar")).toHaveCount(0);
    await expect(page.locator(".formatbar")).toHaveCount(0);
    await expect(
      page.locator(
        ".titlebar, .global-search, .user-avatar, .document-meta, .writing-tip",
      ),
    ).toHaveCount(0);
    await page.locator(".tree-item").filter({ hasText: "列表与块" }).click();
    const heading = page
      .locator(".ProseMirror h2")
      .filter({ hasText: "实现方案" });
    await expect(heading).toBeVisible();
    const disk = path.join(directory, "示例知识库", "列表与块.md");
    const inspect = async () => {
      const ast = parser.parse(await fs.readFile(disk, "utf8"));
      const items: {
        depth: number;
        children: string[];
        checked: boolean | null;
      }[] = [];
      function walk(node: any, depth = 0) {
        const nextDepth = depth + (node.type === "listItem" ? 1 : 0);
        if (node.type === "listItem" && node.children[0]?.type === "heading") {
          items.push({
            depth: nextDepth,
            children: node.children.map((n: any) => n.type),
            checked: node.children.find((n: any) => n.type === "list")
              ?.children[0].checked,
          });
        }
        node.children?.forEach((n: any) => walk(n, nextDepth));
      }
      walk(ast);
      return items[0];
    };
    expect(await inspect()).toEqual({
      depth: 1,
      children: ["heading", "paragraph", "code", "table", "list"],
      checked: false,
    });
    await page.getByRole("checkbox", { name: "完成列表任务" }).click();
    await expect.poll(async () => (await inspect()).checked).toBe(true);
    await page.getByRole("checkbox", { name: "完成列表任务" }).click();
    await expect.poll(async () => (await inspect()).checked).toBe(false);
    await page.locator(".ProseMirror").focus();
    await heading.click({ position: { x: 20, y: 15 } });
    await page.keyboard.press("Tab");
    await expect.poll(inspect).toEqual({
      depth: 2,
      children: ["heading", "paragraph", "code", "table", "list"],
      checked: false,
    });
    // Exercise editing and the heading command in the nested item, not only rendering.
    await page.keyboard.press("End");
    await page.keyboard.insertText("已验证");
    await page.keyboard.press("Control+Alt+3");
    await expect(page.locator(".ProseMirror h3")).toContainText(
      "实现方案已验证",
    );
    await page.keyboard.press("Control+Alt+2");
    await page.keyboard.press("Shift+Tab");
    await expect.poll(inspect).toEqual({
      depth: 1,
      children: ["heading", "paragraph", "code", "table", "list"],
      checked: false,
    });
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(page.locator(".source-editor .cm-content")).toContainText(
      "## 实现方案已验证",
    );
    await page.getByRole("button", { name: "预览编辑", exact: true }).click();
    await expect(page.locator(".ProseMirror h2")).toContainText(
      "实现方案已验证",
    );
    await expect(page.locator(".ProseMirror table.children")).toBeVisible();
    await expect(
      page.locator(".milkdown-code-block .cm-content"),
    ).toContainText("const editor");
    await page.screenshot({ path: path.join(project, "preview-lists.png") });
    await page.locator(".ProseMirror").focus();
    await heading.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("新的列表项");
    await expect
      .poll(async () =>
        (await fs.readFile(disk, "utf8")).includes("新的列表项"),
      )
      .toBeTruthy();
    await page
      .getByRole("button", { name: "显示格式工具栏", exact: true })
      .click();
    await expect(page.locator(".formatbar")).toBeVisible();
    await page
      .getByRole("button", { name: "隐藏格式工具栏", exact: true })
      .click();
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    await page.getByRole("slider", { name: "正文行高", exact: true }).focus();
    await page.keyboard.press("End");
    await expect(
      page.getByRole("slider", { name: "正文行高", exact: true }),
    ).toHaveValue("2.4");
    await page.getByRole("button", { name: "恢复默认", exact: true }).click();
    await expect(
      page.getByRole("slider", { name: "正文行高", exact: true }),
    ).toHaveValue("1.75");
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(
      page.getByRole("switch", { name: "常驻格式工具栏", exact: true }),
    ).toHaveAttribute("aria-checked", "false");
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
