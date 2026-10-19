import {selectPreference} from './helpers/runtime-ui';
import { _electron as electron, expect, test } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";
import { openRuntimeInstaller } from "./helpers/runtime-ui";
const project = path.resolve(import.meta.dirname, ".."), work = path.resolve(project, "../../work");
test.setTimeout(300000);
async function fixture() {
  const data = await fs.mkdtemp(path.join(work, "manual-e2e-v1810-"));
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: "1", MOYU_TEST_SKIP_BUNDLED: "1", MOYU_DEMO: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(
    process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env }
      : { args: [project], env },
  );
  const page = await app.firstWindow();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await (await app.browserWindow(page)).evaluate(w => {
    w.show();
    w.focus();
    w.webContents.focus();
  });
  await app.evaluate(() => {
    globalThis.fetch = async () => {
      throw Error("unexpected network");
    };
  });
  return { app, page, data };
}
test("Manual file table rejects corrupt files, preserves cancellation and installs a verified SQL archive through the UI offline", async () => {
  const { app, page, data } = await fixture();
  try {
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    await selectPreference(page,"SQL");
    await page.getByRole("tab", { name: "环境", exact: true }).click();
    await openRuntimeInstaller(page);
    await page.getByRole("group", { name: "环境安装方式" }).getByRole("button", {
      name: "本地导入",
      exact: true,
    }).click();
    const table = page.getByLabel("手动添加环境", { exact: true });
    await expect(table.locator(".runtime-tree-row")).toHaveCount(1);
    await expect(table.locator("a")).toHaveAttribute("href", /sql.js-1.14.2.tgz$/);
    await expect(table.getByRole("button", { name: "添加并启用", exact: true })).toBeDisabled();
    const wrong = path.join(data, "wrong.tgz");
    await fs.writeFile(wrong, "not an environment");
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, wrong);
    await table.getByRole("button", { name: /选择文件 sql.js/ }).click();
    await expect(table).toContainText("归档");
    await expect(table.getByRole("button", { name: "添加并启用", exact: true })).toBeDisabled();
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    await table.getByRole("button", { name: /选择文件 sql.js/ }).click();
    await expect(table).toContainText("归档");
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, path.join(work, "manual-downloads-v1810/sql.js-1.14.2.tgz"));
    await table.getByRole("button", { name: /选择文件 sql.js/ }).click();
    await expect(table).toContainText("已验证");
    await expect(table.getByLabel("手动环境版本")).toHaveCount(0);
    await expect(table).toContainText("版本 1.14.2");
    await table.getByRole("button", { name: "添加并启用", exact: true }).click();
    await expect(page.locator(".runtime-installed")).toContainText("1.14.2");
    await expect(table.getByRole("status", { name: "已安装", exact: true })).toBeVisible();
    await expect(table.getByRole("button", { name: "已安装", exact: true })).toHaveCount(0);
    await expect(table.getByRole("button", { name: "添加并启用", exact: true })).toHaveCount(0);
    await page.screenshot({ path: path.join(work, "manual-sql-v1810.png") });
    await selectPreference(page,"C#");
    await page.getByRole("tab", { name: "环境", exact: true }).click();
    await openRuntimeInstaller(page);
    await page.getByRole("group", { name: "环境安装方式" }).getByRole("button", {
      name: "本地导入",
      exact: true,
    }).click();
    await expect(table.getByRole("button", { name: "dist/", exact: true })).toHaveAttribute("aria-expanded", "false");
    await table.getByRole("button", { name: "dist/", exact: true }).click();
    await table.getByRole("button", { name: "_framework", exact: true }).click();
    await expect(table.locator('[data-runtime-file]')).toHaveCount(213);
    await expect(table.getByRole("button", {name:"选择运行文件夹",exact:true})).toHaveCount(1);
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
test("Original downloaded files install all eight engines without network; execution and CSharp/Java formatters retain sandbox behavior", async () => {
  const { app, page } = await fixture();
  try {
    for (
      const [language, codeLanguage, code] of [
        ["clang", "c", "printf(\"%d\",21*2);"],
        ["sql", "sql", "SELECT 21*2 AS answer;"],
        ["lua", "lua", "print(21*2)"],
        ["ruby", "ruby", "puts 21*2"],
        ["bash", "bash", "echo $((21*2))"],
        ["java", "java", "System.out.println(21*2);"],
        ["csharp", "csharp", "Console.WriteLine(21*2);"],
        ["python", "python", "print(21*2)"],
      ]
    ) {
      const response: any = await page.evaluate(
        language => window.moyu!.feature("manual-files.plan", { language }),
        language,
      );
      expect(response.ok, JSON.stringify(response)).toBe(true);
      let plan = response.data;
      for (const row of plan.files) {
        let source: string;
        if (row.type === "bundle") {
          source = path.join(work, "manual-downloads-v1810/roslynweb-source-and-wasm.zip");
        } else if (row.type === "asset") {
          source = path.join(work, "runtime-v183/runtimes/java/Runtime/2026.10.12/java", row.name);
        } else if (row.type === "python") source = path.join(project, "resources/pyodide", row.name);
        else source = path.join(work, "manual-downloads-v1810", row.name);
        await app.evaluate(({ dialog }, file) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
        }, source);
        const result: any = await page.evaluate(input => window.moyu!.feature("manual-files.select", input), {
          language,
          token: plan.token,
          id: row.id,
        });
        expect(result.ok, language + " " + JSON.stringify(result)).toBe(true);
        plan = result.data;
        expect(plan.files.find((file: any) => file.id === row.id).verified, JSON.stringify(plan)).toBe(true);
      }
      if (language === "python") {
        const removed: any = await page.evaluate(() =>
          window.moyu!.feature("python.remove-runtime", { version: "314.0.7" })
        );
        expect(removed.ok, JSON.stringify(removed)).toBe(true);
      }
      const installed: any = await page.evaluate(
        input =>
          window.moyu!.feature(
            input.language === "python" ? "python.import-files" : "runtime.import-files",
            input,
          ),
        { language, token: plan.token },
      );
      expect(installed.ok, language + " " + JSON.stringify(installed)).toBe(true);
      const run: any = await page.evaluate(input => window.moyu!.feature("code.run", input), {
        language: codeLanguage,
        code,
      });
      expect(run.ok, JSON.stringify(run)).toBe(true);
      expect(run.data.error, language + " " + JSON.stringify(run)).toBe("");
      if (language === "sql") {
        const rows: any = await page.evaluate(
          token => window.moyu!.feature("code.result-page", { token, page: 0 }),
          run.data.artifacts[0].token,
        );
        expect(rows.data.rows[0][0]).toBe("42");
      } else expect(run.data.output.trim()).toBe("42");
      if (["java", "csharp"].includes(language)) {
        const formatted: any = await page.evaluate(input => window.moyu!.feature("code.format", input), {
          language,
          code: language === "java"
            ? "class Main{public static void main(String[] args){System.out.println(21*2);}}"
            : code,
          config: { indentWidth: 2 },
          pluginConfig: {},
        });
        expect(formatted.ok, JSON.stringify(formatted)).toBe(true);
        expect(formatted.data).toContain("21 * 2");
      }
    }
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
