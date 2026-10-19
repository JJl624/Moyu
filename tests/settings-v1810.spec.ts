import {selectPreference} from './helpers/runtime-ui';
import { _electron as electron, expect, test } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";
import { seedRuntimeCache } from "./helpers/runtime-cache";
import { openRuntimeInstaller } from "./helpers/runtime-ui";
test.setTimeout(180000);
const project = path.resolve(import.meta.dirname, ".."), work = path.resolve(project, "../../work");
async function fixture(seed = true) {
  const data = await fs.mkdtemp(path.join(work, "settings-v1810-"));
  if (seed) await seedRuntimeCache(data);
  await fs.writeFile(
    path.join(data, "settings.json"),
    JSON.stringify({ version: 1, values: { "moyu-save-policy": "close" } }),
  );
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: "1", MOYU_DEMO: "1",
    MOYU_TEST_SKIP_BUNDLED: seed ? "" : "1" };
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
  return { app, page, data };
}
test("Environment installation combines local and online sources; previews identify missing files and imports run only after confirmation", async () => {
  const { app, page, data } = await fixture(false);
  try {
    const source = path.join(work, "runtime-v18/runtimes/lua/Runtime/1.16.0");
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    await selectPreference(page,"Lua");
    await page.getByRole("tab", { name: "环境", exact: true }).click();
    await openRuntimeInstaller(page);
    await expect(page.getByLabel("下载源", { exact: true })).toBeVisible();
    await page.getByRole("group", { name: "环境安装方式" }).getByRole("button", { name: "本地导入", exact: true })
      .click();
    await expect(page.getByLabel("运行环境版本")).toBeHidden();
    await expect(page.getByRole("button", { name: "导入并启用" })).toHaveCount(0);
    const empty = path.join(data, "empty");
    await fs.mkdir(empty);
    await app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, empty);
    await page.getByRole("button", { name: "选择文件夹", exact: true }).click();
    await expect(page.locator(".manual-runtime-import [role=alert]")).toContainText("没有所需");
    await expect(page.getByRole("button", { name: "导入并启用", exact: true })).toHaveCount(0);
    await app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, source);
    await page.getByRole("button", { name: "选择文件夹", exact: true }).click();
    await expect(page.locator(".runtime-import-preview")).toContainText("识别版本：1.16.0");
    await expect(page.getByRole("button", { name: "导入并启用", exact: true })).toBeEnabled();
    expect(await fs.readdir(path.join(data, "runtimes/lua/Runtime")).catch(() => [])).toEqual([]);
    await page.getByRole("button", { name: "导入并启用", exact: true }).click();
    await expect(page.locator(".runtime-notice")).toHaveText("已导入");
    await expect(page.locator(".runtime-installed")).toContainText("1.16.0");
    await expect(page.locator(".runtime-import-preview").getByRole("status",{name:"已安装",exact:true})).toBeVisible();
    await expect(page.locator(".runtime-import-preview").getByRole("button",{name:"已安装",exact:true})).toHaveCount(0);
    await expect(page.getByRole("button",{name:"导入并启用",exact:true})).toHaveCount(0);
    await page.screenshot({ path: path.join(work, "runtime-import-v1810.png") });
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test("Complete npm environment directories install all five package-based engines offline and execute in their existing sandboxes", async () => {
  const { app, page } = await fixture(false);
  try {
    await app.evaluate(() => {
      globalThis.fetch = async () => {
        throw Error("unexpected network");
      };
    });
    const entries = [
      [
        "clang",
        "runtime-v18/runtimes/clang/Runtime/0.3.0/node_modules/@live-codes/clang-wasm",
        "c",
        "printf(\"%d\",21*2);",
      ],
      ["sql", "runtime-v18/runtimes/sql/Runtime/1.14.2/node_modules/sql.js", "sql", "SELECT 21*2 AS answer;"],
      ["lua", "runtime-v18/runtimes/lua/Runtime/1.16.0/node_modules/wasmoon", "lua", "print(21*2)"],
      ["ruby", "runtime-v184/runtimes/ruby/Runtime/2.10.1/node_modules/@ruby/4.0-wasm-wasi", "ruby", "puts 21*2"],
      [
        "bash",
        "runtime-v184/runtimes/bash/Runtime/0.18.2/node_modules/@everruns/bashkit-wasm",
        "bash",
        "echo $((21*2))",
      ],
    ];
    for (const [language, source, codeLanguage, code] of entries) {
      await app.evaluate(({ dialog }, source) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
      }, path.join(work, source));
      const preview: any = await page.evaluate(
        language => window.moyu!.feature("local-import.inspect", { language }),
        language,
      );
      expect(preview.ok, JSON.stringify(preview)).toBe(true);
      expect(preview.data.issues, JSON.stringify(preview)).toEqual([]);
      const installed: any = await page.evaluate(input => window.moyu!.feature("runtime.import", input), {
        language,
        token: preview.data.token,
      });
      expect(installed.ok, language + " " + JSON.stringify(installed)).toBe(true);
      const result: any = await page.evaluate(input => window.moyu!.feature("code.run", input), {
        language: codeLanguage,
        code,
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(result.data.error, JSON.stringify(result)).toBe("");
      if (language === "sql") {
        const table: any = await page.evaluate(
          token => window.moyu!.feature("code.result-page", { token, page: 0 }),
          result.data.artifacts[0].token,
        );
        expect(table.data.rows[0][0]).toBe("42");
      } else expect(result.data.output.trim()).toBe("42");
    }
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test("Formatting tool table really collapses; language settings have a single divider and code data defaults to existing folders", async () => {
  const { app, page } = await fixture();
  try {
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    await selectPreference(page,"编辑");
    await page.getByRole("tab", { name: "参考", exact: true }).click();
    const table = page.locator(".formatting-tools > table");
    await expect(table).toBeHidden();
    await page.locator(".formatting-tools summary").click();
    await expect(table).toBeVisible();
    await page.locator(".formatting-tools summary").click();
    await expect(table).toBeHidden();
    for (const name of ["JavaScript", "C / C++", "Lua", "SQL"]) {
      await selectPreference(page,name);
      const last = page.locator(".runtime-panel:not([hidden]) .pref-section .pref-row").last();
      if (await last.count()) await expect(last).toHaveCSS("border-bottom-width", "0px");
    }
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    if (await page.getByTitle("显示文档信息", { exact: true }).count()) {
      await page.getByTitle("显示文档信息", { exact: true }).click();
    }
    await page.getByRole("tab", { name: "数据", exact: true }).click();
    await expect(page.getByLabel("按目录筛选代码数据")).toHaveValue("existing");
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test("C compiler optimization and argv use the real toolchain; Lua arguments preserve Unicode and quotes without host access", async () => {
  const { app, page } = await fixture();
  try {
    for (const [optimizationLevel, expected] of [["O0", "plain"], ["O2", "optimized"]]) {
      await page.evaluate(settings => window.moyu!.feature("code.runtime-configure", { language: "c", settings }), {
        optimizationLevel,
      });
      const result: any = await page.evaluate(() =>
        window.moyu!.feature("code.run", {
          language: "c",
          arguments: ["中文", "a b"],
          code:
            "#include <stdio.h>\nint main(int argc,char **argv){\n#ifdef __OPTIMIZE__\nputs(\"optimized\");\n#else\nputs(\"plain\");\n#endif\nfor(int i=1;i<argc;i++)puts(argv[i]);return 0;}",
        })
      );
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(result.data.error, JSON.stringify(result)).toBe("");
      expect(result.data.output).toContain(expected);
      expect(result.data.output).toContain("中文");
      expect(result.data.output).toContain("a b");
    }
    const result: any = await page.evaluate(() =>
      window.moyu!.feature("code.run", {
        language: "lua",
        arguments: ["中文", "a\"b", "a\\b", "line\nbreak"],
        code: "for _,value in ipairs(arg) do print(value) end; print(os.execute == nil, io.popen == nil)",
      })
    );
    expect(result.data.error, JSON.stringify(result)).toBe("");
    expect(result.data.output).toContain("中文\na\"b\na\\b\nline\nbreak\n");
    expect(result.data.output).toContain("true\ttrue");
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test("Knowledge-base deletion confirms the actual directory, saves before deletion, closes the workspace and removes its recent entry", async () => {
  const { app, page, data } = await fixture(false);
  try {
    const root = path.join(data, "示例知识库");
    await page.evaluate(() => window.moyu!.feature("preferences.set", { key: "moyu-save-policy", value: "close" }));
    await page.evaluate(() => window.moyu!.create("删除前保存.md", "file", "原文"));
    await page.locator(".tree-item[title=\"删除前保存.md\"]").dblclick();
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("追加");
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0 });
    });
    await page.getByRole("button", { name: "知识库导航", exact: true }).click();
    await page.getByRole("button", { name: "删除知识库 示例知识库", exact: true }).click();
    await expect(page.getByRole("button", { name: "删除知识库 示例知识库", exact: true })).toBeEnabled();
    await expect(page.locator(".tab.active")).toContainText("删除前保存");
    await app.evaluate(({ dialog, shell }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
      shell.trashItem = async () => {
        throw Error("测试删除失败");
      };
    });
    await page.getByRole("button", { name: "删除知识库 示例知识库", exact: true }).click();
    await expect(page.locator(".navigation-page [role=alert]")).toHaveText("测试删除失败");
    const stillOpen: any = await page.evaluate(() => window.moyu!.load());
    expect(stillOpen.data.root).toBe(root);
    await app.evaluate(({ dialog, shell }) => {
      dialog.showMessageBox = async (_window, options) => {
        (globalThis as any).__deleteDetail = options.detail;
        return { response: 1 };
      };
      shell.trashItem = async path => {
        (globalThis as any).__trashed = path;
      };
    });
    await page.getByRole("button", { name: "删除知识库 示例知识库", exact: true }).click();
    await expect(page.locator(".navigation-page")).toBeVisible();
    await expect(page.locator(".tab")).toHaveCount(0);
    expect(await app.evaluate(() => (globalThis as any).__trashed)).toBe(root);
    expect(await app.evaluate(() => (globalThis as any).__deleteDetail)).toBe(root);
    const state: any = await page.evaluate(() => window.moyu!.feature("navigation.get"));
    expect(state.data.recent.some((item: any) => item.root === root)).toBe(false);
    expect(await fs.readFile(path.join(root, "删除前保存.md"), "utf8")).toContain("追加");
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
