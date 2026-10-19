import {selectPreference} from './helpers/runtime-ui';
import { _electron as electron, expect, test } from "./helpers/test";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url), receipts = require("../resources/manual-runtime-files.json");
const project = path.resolve(import.meta.dirname, ".."), work = path.resolve(project, "../../work");
test.setTimeout(180000);
async function fixture(theme = "light") {
  const data = await fs.mkdtemp(path.join(work, "environment-manager-"));
  await fs.writeFile(path.join(data, "settings.json"),JSON.stringify({version:1,values:{"moyu-theme":theme}}));
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: "1", MOYU_TEST_SKIP_BUNDLED: "1", MOYU_DEMO: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(
    process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env }
      : { args: [project], env },
  );
  const page = await app.firstWindow();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await (await app.browserWindow(page)).evaluate(window => {
    window.show();
    window.focus();
    window.webContents.focus();
  });
  await app.evaluate(() => {
    globalThis.fetch = async () => {
      throw Error("Unexpected network");
    };
  });
  await page.getByRole("button", { name: "偏好设置", exact: true }).click();
  return { app, page, data };
}
test("Online contents are shown directly, split compiler/formatter downloads, and remain available offline", async () => {
  const { app, page } = await fixture();
  try {
    for (const name of ["C#", "Java", "SQL", "Lua", "C / C++", "Ruby", "Bash", "Python"]) {
      await selectPreference(page,name);
      await page.getByRole("tab", { name: "环境", exact: true }).click();
      await expect(page.getByRole("button", { name: "添加环境", exact: true })).toHaveCount(0);
      await expect(page.getByRole("group", { name: "环境安装方式" })).toBeVisible();
      const contents = page.getByLabel("环境内容", { exact: true });
      await contents.scrollIntoViewIfNeeded();
      await expect(contents.locator(".runtime-tree-row").first()).toBeVisible();
      if (["Java", "C#"].includes(name)) {
        await expect(contents).toContainText("编译器与标准库");
        await expect(contents).toContainText("格式化插件与依赖");
        if (name === "C#") {
          await expect(contents).not.toContainText("dotnet.js");
          await expect(contents.getByRole("link",{name:"项目主页",exact:true})).toHaveAttribute("href","https://github.com/wieslawsoltes/RoslynWeb");
          await expect(contents.getByRole("link",{name:"官方下载页",exact:true})).toHaveCount(0);
          await contents.getByRole("button", {name: "dist/", exact:true}).click();
          await contents.getByRole("button", {name: "_framework", exact:true}).click();
          await expect(contents.locator("[data-runtime-file]")).toHaveCount(213);
          await page.screenshot({path:path.join(work,"environment-csharp-tree-light-v1825.png")});
        }
        if (name === "Java") await contents.getByRole("button", {name: "TeaVM/", exact:true}).click();
        await expect(contents.locator("a").first()).toHaveAttribute("href", /^https:\/\//);
      }
    }
    await selectPreference(page,"Lua");
    await page.getByRole("tab", {name:"环境",exact:true}).click();
    const lua = page.getByLabel("环境内容", {exact:true});
    await lua.scrollIntoViewIfNeeded();
    const archive=lua.getByRole("button",{name:"wasmoon",exact:true});
    await expect(archive).toHaveAttribute("aria-expanded","false");
    await expect(archive).toContainText("wasmoon-1.16.0.tgz");
    await expect(lua).not.toContainText("emscripten");
    await archive.focus();await page.keyboard.press("Enter");
    await lua.getByRole("button", {name:"依赖包",exact:true}).click();
    await expect(lua).toContainText("emscripten-1.39.10.tgz");
    await expect(lua).not.toContainText("软件生成的文件");
    await page.screenshot({path:path.join(work,"environment-lua-tree-light-v1825.png")});
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
test("Local imports need no version field, infer a renamed archive and expose installed contents after activation", async () => {
  const { app, page, data } = await fixture();
  try {
    await selectPreference(page,"SQL");
    await page.getByRole("tab", { name: "环境", exact: true }).click();
    await page.getByRole("group", { name: "环境安装方式" }).getByRole("button", { name: "本地导入", exact: true })
      .click();
    const local = page.getByLabel("手动添加环境", { exact: true });
    await expect(local).toContainText("sql.js-1.14.2.tgz");
    await expect(local.getByLabel("手动环境版本")).toHaveCount(0);
    await expect(local.getByRole("button", { name: "识别版本" })).toHaveCount(0);
    const file = path.join(data, "环境.tgz");
    await fs.copyFile(path.join(work, "manual-downloads-v1810/sql.js-1.14.2.tgz"), file);
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, file);
    await local.getByRole("button", { name: "选择文件", exact: true }).click();
    await expect(local).toContainText("已验证 1 / 1");
    await local.getByRole("button", { name: "添加并启用", exact: true }).click();
    await expect(page.locator(".runtime-installed")).toContainText("1.14.2");
    await page.getByRole("group", { name: "环境安装方式" }).getByRole("button", { name: "在线安装", exact: true })
      .click();
    const contents = page.getByLabel("环境内容", { exact: true });
    await contents.scrollIntoViewIfNeeded();
    await expect(contents).toContainText("已安装内容");
    await expect(contents).toContainText("sql.js-1.14.2.tgz");
    await expect(contents).not.toContainText("viewer-runtime.mjs");
    await expect(contents.locator("a")).toHaveCount(0);
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
for (const [name, language, version] of [["C#", "csharp", "10.0.0"], ["Java", "java", "2026.10.12"]]) {
  test(name + " imports the raw compiler folder and separately verifies formatter archives", async () => {
    const { app, page } = await fixture();
    try {
      await selectPreference(page,name);
      await page.getByRole("tab", { name: "环境", exact: true }).click();
      await page.getByRole("group", { name: "环境安装方式" }).getByRole("button", { name: "本地导入", exact: true })
        .click();
      const folder = path.join(work, "runtime-v183/runtimes", language, "Runtime", version, language);
      await app.evaluate(({ dialog }, folder) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      }, folder);
      const local = page.getByLabel("手动添加环境", { exact: true });
      await local.getByRole("button", { name: "选择文件夹", exact: true }).click();
      await expect(local).toContainText("已验证 " + (language === "csharp" ? "1 / 2" : "4 / 17"));
      await expect(local).toContainText("格式化插件与依赖");
      const files = receipts.kinds[language].map(key =>
        path.join(work, "manual-downloads-v1810", receipts.packages[key].file)
      );
      await app.evaluate(({ dialog }, files) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
      }, files);
      await local.getByRole("button", { name: "选择文件", exact: true }).click();
      await expect(local).toContainText("已验证 " + (language === "csharp" ? "2 / 2" : "17 / 17"));
      await local.getByRole("button", { name: "添加并启用", exact: true }).click();
      await expect(page.locator(".runtime-installed")).toContainText(version, { timeout: 60000 });
      const result: any = await page.evaluate(
        language =>
          window.moyu!.feature("code.run", {
            language,
            code: language === "csharp" ? "Console.WriteLine(\"ready\");" : "System.out.println(\"ready\");",
          }),
        language,
      );
      expect(result.data.error, JSON.stringify(result)).toBe("");
      expect(result.data.output.trim()).toBe("ready");
      await page.screenshot({ path: path.join(work, "environment-import-" + language + "-v1813.png") });
    } finally {
      await app.evaluate(({ app }) => app.exit(0));
    }
  });
}

for(const theme of ["light", "dark"]) test("Manual dependency tree keeps archive verification and selection separate from expansion ("+theme+")",async()=>{
  const {app,page}=await fixture(theme);
  try{
    await selectPreference(page,"Lua");
    await page.getByRole("tab",{name:"环境",exact:true}).click();
    await page.getByRole("group",{name:"环境安装方式"}).getByRole("button",{name:"本地导入",exact:true}).click();
    const local=page.getByLabel("手动添加环境",{exact:true});
    const archive=local.getByRole("button",{name:"wasmoon",exact:true});
    await expect(archive).toHaveAttribute("aria-expanded","false");
    await archive.click();
    await local.getByRole("button",{name:"依赖包",exact:true}).click();
    const before:any=await page.evaluate(()=>window.moyu!.feature("manual-files.plan",{language:"lua"}));
    const files=before.data.files;
    for(const file of files){
      await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path.join(work,"manual-downloads-v1810",file.name));
      await local.getByRole("button",{name:"选择文件 "+file.name,exact:true}).click();
      await expect(archive).toHaveAttribute("aria-expanded","true");
    }
    await expect(local).toContainText("已验证 2 / 2");
    await expect(local.getByRole("button",{name:"添加并启用",exact:true})).toBeEnabled();
    await page.screenshot({path:path.join(work,"manual-lua-tree-"+theme+"-v1825.png")});
    const overflow=await local.evaluate(el=>el.scrollWidth>el.clientWidth+1);
    expect(overflow).toBe(false);
  } finally {await app.evaluate(({app})=>app.exit(0));}
});

for(const theme of ["light","dark"]) test("Installed compiler inventory hides download links throughout expanded folders and manual requirements ("+theme+")",async()=>{
  const {app,page,data}=await fixture(theme);
  try {
    await fs.cp(path.join(work,"runtime-v183/runtimes/csharp"),path.join(data,"runtimes/csharp"),{recursive:true});
    await selectPreference(page,"C#");
    await page.getByRole("tab",{name:"环境",exact:true}).click();
    const inventory=page.getByLabel("环境内容",{exact:true});
    await inventory.scrollIntoViewIfNeeded();
    await expect(inventory).toContainText("已安装内容");
    await inventory.getByRole("button",{name:"dist/",exact:true}).click();
    await inventory.getByRole("button",{name:"_framework",exact:true}).click();
    await expect(inventory).toContainText("dotnet.js");
    await expect(inventory.locator("a")).toHaveCount(0);
    await page.getByRole("group",{name:"环境安装方式"}).getByRole("button",{name:"本地导入",exact:true}).click();
    const local=page.getByLabel("手动添加环境",{exact:true});
    await local.getByRole("button",{name:"dist/",exact:true}).click();
    await local.getByRole("button",{name:"_framework",exact:true}).click();
    await expect(local.locator("a")).toHaveCount(0);
    await local.getByRole("button",{name:"dist/",exact:true}).click();
    const status=local.getByRole("status",{name:"已安装",exact:true});
    await expect(status).toBeVisible();
    await expect(local.locator(".manual-files-heading")).toContainText("已安装");
    await expect(local.getByRole("button",{name:"已安装",exact:true})).toHaveCount(0);
    await expect(local.getByRole("button",{name:"添加并启用",exact:true})).toHaveCount(0);
    expect(await status.evaluate(el=>el.tagName)).toBe("SPAN");
    await page.screenshot({path:path.join(work,"local-installed-"+theme+"-v190.png")});
  } finally {await app.evaluate(({app})=>app.exit(0));}
});
