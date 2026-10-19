import { test, expect, _electron as electron, type Page } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";

const project = path.resolve(import.meta.dirname, "..");
const content = `# 列表对齐

98. 第一项正文
99. 第二项正文
100. # 一级标题
101. ## 二级标题
102. ### 三级标题
103. #### 四级标题
104. ##### 五级标题
105. ###### 六级标题
106. 段落与块

     \`\`\`javascript
     console.log(42)
     \`\`\`

     | 项目 | 状态 |
     | --- | --- |
     | 缩进 | 保留 |

     998. 嵌套正文
     999. 嵌套正文
     1000. 嵌套正文

     - 子列表正文
     - [ ] 子任务
107. 长正文第一行包含行内代码 \`value\` 与加粗 **内容**。这段正文在窄窗口下应当自动换行，并保持序号与首行对齐。  
     第二行正文
`;

async function verifyLayout(page: Page) {
  // Zero-height inline probes expose real text baselines, including different
  // body/heading font metrics. Remove them synchronously before DOM observers run.
  const layout = await page.evaluate(() => {
    function baseline(element: Element) {
      const probe = document.createElement("span");
      probe.style.cssText = "display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline";
      element.prepend(probe);
      const result = probe.getBoundingClientRect().top;
      probe.remove();
      return result;
    }
    const items = [...document.querySelectorAll(".ProseMirror .list-item")].map(item => {
      const label = item.querySelector(":scope > .label-wrapper > .label")!;
      const first = item.querySelector(":scope > .children > .content-dom > :first-child")!;
      const range = document.createRange(); range.selectNodeContents(label);
      return {
        text: label.textContent,
        delta: baseline(label) - baseline(first),
        markerWidth: label.getBoundingClientRect().width,
        textWidth: range.getBoundingClientRect().width,
      };
    });
    const columns = [...document.querySelectorAll(".ProseMirror :is(ol,ul)")].map(list =>
      [...list.querySelectorAll(":scope > .milkdown-list-item-block > .list-item > .children")]
        .map(child => child.getBoundingClientRect().left),
    );
    const firstTwo = [...document.querySelector(".ProseMirror > ol")!.children].slice(0, 2);
    return { items, columns, gap: firstTwo[1].getBoundingClientRect().top - firstTwo[0].getBoundingClientRect().bottom };
  });
  expect(layout.items).toHaveLength(15);
  expect(layout.items.map(item => item.text)).toContain("1000.");
  for (const item of layout.items) {
    expect(Math.abs(item.delta), `Baseline of ${item.text}`).toBeLessThan(1);
    expect(item.markerWidth + 0.5, `Marker width of ${item.text}`).toBeGreaterThanOrEqual(item.textWidth);
  }
  for (const column of layout.columns) expect(Math.max(...column) - Math.min(...column)).toBeLessThan(1);
  return layout;
}

test("List markers follow the first text baseline and share a column across font sizes and nesting", async () => {
  const work = path.resolve(project, "../../work/e2e");
  await fs.mkdir(work, { recursive: true });
  const directory = await fs.mkdtemp(path.join(work, "list-alignment-"));
  const env = { ...process.env, MOYU_USER_DATA: directory, MOYU_TEST: "1", MOYU_DEMO: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [project], env });
  try {
    const page = await app.firstWindow(), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await expect(page.locator(".ProseMirror h1")).toBeVisible();
    await page.evaluate(async content => { await window.moyu!.create("列表对齐.md", "file", content); }, content);
    await page.getByRole("button", { name: "列表对齐", exact: true }).click();
    await expect(page.locator(".ProseMirror .list-item")).toHaveCount(15);
    expect((await verifyLayout(page)).gap).toBe(8);
    await page.screenshot({ path: path.join(project, "preview-list-alignment.png") });
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    await page.getByLabel("正文字体", { exact: true }).fill("Consolas");
    await page.getByLabel("标题字体", { exact: true }).fill("Arial");
    for (const endpoint of ["Home", "End"]) {
      for (const name of ["文字大小", "正文行高", "标题比例", "列表间距"]) {
        await page.getByRole("slider", { name, exact: true }).focus();
        await page.keyboard.press(endpoint);
      }
      const layout = await verifyLayout(page);
      expect(layout.gap).toBe(endpoint === "Home" ? 0 : 24);
    }
    await page.getByRole("button", { name: "恢复默认", exact: true }).click();
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('moyu://app'))!.setSize(900, 900));
    await verifyLayout(page);
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(page.locator(".source-editor .cm-content")).toContainText("1000. 嵌套正文");
    await page.getByRole("button", { name: "阅读", exact: true }).click();
    await expect(page.locator(".reading-view li")).toHaveCount(15);
    // Native reading-mode markers use the browser's text baseline. Check sibling
    // text columns and preserved nested block placement, including long numbers.
    const reading = await page.evaluate(() => [...document.querySelectorAll(".reading-view :is(ol,ul)")].map(list =>
      [...list.children].map(child => child.getBoundingClientRect().left),
    ));
    for (const column of reading) expect(Math.max(...column) - Math.min(...column)).toBeLessThan(1);
    await expect(page.locator(".reading-view li table")).toBeVisible();
    await page.getByRole("button", { name: "预览编辑", exact: true }).click();
    await verifyLayout(page);
    expect(await fs.readFile(path.join(directory, "示例知识库", "列表对齐.md"), "utf8")).toBe(content);
    expect(errors).toEqual([]);
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});
