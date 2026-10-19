import {selectPreference} from './helpers/runtime-ui';
import {openRuntimeInstaller} from './helpers/runtime-ui';
import { _electron as electron, expect, test } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";
import { seedRuntimeCache } from "./helpers/runtime-cache";
const project = path.resolve(import.meta.dirname, ".."), work = path.resolve(project, "../../work");
async function fixture(theme = "light", seed = true) {
  const data = await fs.mkdtemp(path.join(work, "v189-"));
  if (seed) await seedRuntimeCache(data);
  await fs.writeFile(
    path.join(data, "settings.json"),
    JSON.stringify({ version: 1, values: { "moyu-theme": theme, "moyu-save-policy": "manual" } }),
  );
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: "1", MOYU_DEMO: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(
    process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env }
      : { args: [project], env },
  );
  const page = await app.firstWindow();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const window = await app.browserWindow(page);
  await window.evaluate(w => {
    w.show();
    w.focus();
    w.webContents.focus();
    w.webContents.setBackgroundThrottling(false);
  });
  await page.getByRole("button", { name: "偏好设置", exact: true }).click();
  return { app, page, data };
}
async function language(page: any, name: string) {
  await selectPreference(page,name);
  await expect(page.locator(".runtime-tabs")).toBeVisible();
}
test("Runtime refresh has one fresh notice, ignores cached prose and preserves upstream-change and failure feedback", async () => {
  const { app, page, data } = await fixture("light", false);
  try {
    const directory = path.join(data, "runtimes/csharp");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, "versions.json"),
      JSON.stringify({ selected: "", versions: ["10.0.0"], refreshMessage: "已检查，当前为最新兼容环境。" }),
    );
    await language(page, "C#");
    await page.getByRole("tab", { name: "环境", exact: true }).click();await openRuntimeInstaller(page);
    await expect(page.locator(".runtime-notice")).toHaveCount(0);
    await expect(page.locator(".runtime-manager")).not.toContainText("最新兼容");
    const bytes=await fs.readFile(path.join(work,"runtime-v183/runtimes/csharp/Runtime/10.0.0/csharp/_framework/dotnet.js"));
    await app.evaluate((_electron,bytes)=>{globalThis.fetch=async()=>new Response(Uint8Array.from(bytes));},Array.from(bytes));
    await page.getByRole("button", { name: "刷新版本", exact: true }).click();
    await expect(page.locator(".runtime-notice[role=status]")).toHaveText("已刷新");
    await expect(page.locator(".runtime-manager [role=status]")).toHaveCount(0);
    await language(page, "Lua");
    await language(page, "C#");
    await page.getByRole("tab", { name: "环境", exact: true }).click();await openRuntimeInstaller(page);
    await expect(page.locator(".runtime-notice")).toHaveCount(0);
    await expect(page.locator(".runtime-manager [role=status]")).toHaveCount(0);
    await app.evaluate(() => {
      globalThis.fetch = async () => new Response("changed runtime");
    });
    await page.getByRole("button", { name: "刷新版本", exact: true }).click();
    await expect(page.locator(".runtime-notice")).toHaveText("下载源版本已变更，暂不可安装新版");
    const state: any = await page.evaluate(() => window.moyu!.feature("runtime.state", { language: "csharp" }));
    expect(state.data.versions).toEqual(["10.0.0"]);
    expect(state.data.upstreamChanged).toBe(true);
    await app.evaluate(() => {
      globalThis.fetch = async () => {
        throw Error("连接失败");
      };
    });
    await page.getByRole("button", { name: "刷新版本", exact: true }).click();
    await expect(page.locator(".runtime-notice[role=alert]")).toContainText("无法连接下载源");
    await expect(page.locator(".runtime-notice[role=status]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "刷新版本", exact: true })).toBeEnabled();
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test("All language settings share one layout; invalid drafts block navigation and corrected drafts save before switching", async () => {
  const { app, page } = await fixture();
  try {
    for (const name of ["Python", "JavaScript", "C / C++", "C#", "Java", "SQL", "Lua", "Ruby", "Bash"]) {
      await language(page, name);
      await expect(page.getByRole("tab", { name: "运行设置", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("button", { name: "重启运行环境", exact: true })).toBeVisible();
      await page.getByRole("tab", { name: "环境", exact: true }).click();await openRuntimeInstaller(page);
      await expect(page.getByRole("tabpanel", { name: "环境", exact: true })).toBeVisible();
      if (name !== "JavaScript") {
        await expect(page.getByRole("button", { name: "本地导入", exact: true })).toBeVisible();
      }
    }
    await language(page, "SQL");
    await page.getByLabel("SQL 查询行数上限", { exact: true }).fill("0");
    await page.getByRole("tab", { name: "环境", exact: true }).click();await openRuntimeInstaller(page);
    await expect(page.getByRole("tab", { name: "运行设置", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".runtime-notice[role=alert]")).toBeVisible();
    await page.getByLabel("SQL 查询行数上限", { exact: true }).fill("42");
    await page.getByRole("tab", { name: "环境", exact: true }).click();await openRuntimeInstaller(page);
    await expect(page.getByRole("tabpanel", { name: "环境", exact: true })).toBeVisible();
    const state: any = await page.evaluate(() => window.moyu!.feature("code.runtime-state", { language: "sql" }));
    expect(state.data.settings.maxRows).toBe(42);
    await page.getByRole("tab", { name: "环境", exact: true }).focus();
    await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { name: "运行设置", exact: true })).toBeFocused();
    await expect(page.getByLabel("SQL 查询行数上限", { exact: true })).toHaveValue("42");
    await page.getByRole("button", { name: "重启运行环境", exact: true }).click();
    await expect(page.locator(".runtime-notice")).toContainText("已重启");
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test("C/C++ header lists expand on demand, preserve language-specific choices and work in both themes", async () => {
  for (const theme of ["light", "dark"]) {
    const { app, page } = await fixture(theme);
    try {
      await language(page, "C / C++");
      await expect(page.getByLabel("C 可用头文件", { exact: true })).toBeHidden();
      await page.locator(".runtime-header-picker summary").click();
      await page.getByLabel("C 筛选头文件", { exact: true }).fill("math.h");
      await page.locator(".runtime-header-list label").filter({ hasText: /^math\.h$/ }).getByRole("checkbox").check();
      await page.getByRole("group", { name: "C/C++ 设置", exact: true }).getByRole("button", {
        name: "C++",
        exact: true,
      }).click();
      await expect(page.getByLabel("C++ 语言标准", { exact: true })).toBeVisible();
      await page.getByLabel("C++ 默认头文件", { exact: true }).fill("iostream, vector");
      await page.getByRole("tab", { name: "环境", exact: true }).click();await openRuntimeInstaller(page);
      const state: any = await page.evaluate(() => window.moyu!.feature("code.runtime-state", { language: "c" }));
      expect(state.data.settings.cHeaders).toContain("math.h");
      expect(state.data.settings.cppHeaders).toEqual(["iostream", "vector"]);
      await page.getByRole("tab", { name: "运行设置", exact: true }).click();
      await page.screenshot({ path: path.join(work, "runtime-settings-v189-" + theme + ".png") });
    } finally {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    }
  }
});
test("Python dependency browsing is paged and filterable; custom mirrors validate without losing the editor", async () => {
  const { app, page } = await fixture();
  try {
    await language(page, "Python");
    await page.getByRole("tab", { name: "依赖", exact: true }).click();
    const rows = page.locator(".python-package");
    expect(await rows.count()).toBeLessThanOrEqual(20);
    const search = await page.getByLabel("搜索 Python 包", { exact: true }).boundingBox(),
      filterBox = await page.getByLabel("筛选 Python 包状态", { exact: true }).boundingBox(),
      group = await page.locator(".runtime-package-filter").boundingBox();
    expect(search!.width).toBeGreaterThan(group!.width * .55);
    expect(filterBox!.width).toBeLessThan(group!.width * .35);
    const first = await rows.first().innerText();
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    expect(await rows.first().innerText()).not.toBe(first);
    await page.getByLabel("搜索 Python 包", { exact: true }).fill("numpy");
    await expect(rows.locator("strong").filter({ hasText: /^numpy$/ })).toHaveCount(1);
    expect((await rows.allTextContents()).every(text => text.toLowerCase().includes("numpy"))).toBe(true);
    await page.screenshot({ path: path.join(work, "python-settings-v189.png") });
    await page.getByRole("tab", { name: "环境", exact: true }).click();await openRuntimeInstaller(page);
    await page.getByLabel("Python 下载源", { exact: true }).selectOption("custom");
    await page.getByLabel("Python 镜像地址", { exact: true }).fill("invalid");
    await page.getByRole("tab", { name: "依赖", exact: true }).click();
    await expect(page.getByRole("tabpanel", { name: "环境", exact: true })).toBeVisible();
    await expect(page.locator(".runtime-notice[role=alert]")).toBeVisible();
    await page.getByRole("button", { name: "刷新可用版本", exact: true }).click();
    await expect(page.getByRole("button", { name: "刷新可用版本", exact: true })).toBeEnabled();
    await page.getByLabel("Python 镜像地址", { exact: true }).fill("https://cdn.jsdelivr.net/pyodide/");
    await expect(page.locator(".runtime-notice[role=alert]")).toBeHidden();
    await page.getByRole("tab", { name: "依赖", exact: true }).click();
    await expect(page.getByRole("tabpanel", { name: "依赖", exact: true })).toBeVisible();
    await expect(page.getByLabel("搜索 Python 包", { exact: true })).toHaveValue("numpy");
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test("Environment deletion is scoped to its version, can be cancelled, and updates installed state only on confirmation", async () => {
  const { app, page } = await fixture();
  try {
    await language(page, "Lua");
    await page.getByRole("tab", { name: "环境", exact: true }).click();await openRuntimeInstaller(page);
    const row = page.locator(".runtime-installed").filter({ hasText: "1.16.0" });
    await row.getByRole("button", { name: "删除", exact: true }).click();
    await row.getByRole("button", { name: "取消", exact: true }).click();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "删除", exact: true }).click();
    await row.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(page.locator(".runtime-version-list")).toContainText("尚未安装");
    await expect(page.locator(".runtime-state")).toContainText("未安装");
    await page.getByRole("tab", { name: "运行设置", exact: true }).click();
    await page.getByRole("button", { name: "安装运行环境", exact: true }).click();
    await expect(page.getByRole("tabpanel", { name: "环境", exact: true })).toBeVisible();
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
