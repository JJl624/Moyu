import {selectPreference} from './helpers/runtime-ui';
import { _electron as electron, expect, test } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";
import { ARGUMENT_CODE, ARGUMENT_VALUES, type ArgumentLanguage } from "../shared/argument-examples.mjs";
const project = path.resolve(import.meta.dirname, ".."), work = path.resolve(project, "../../work");
async function fixture() {
  const data = await fs.mkdtemp(path.join(work, "arguments-v1816-"));
  await fs.writeFile(
    path.join(data, "settings.json"),
    JSON.stringify({version:1,code:{ clang: { arguments: ["old"] }, java: { arguments: ["old"] }, ruby: { arguments: ["old"] } }}),
  );
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: "1", MOYU_DEMO: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(
    process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env }
      : { args: [project], env },
  );
  const page = await app.firstWindow();
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30000 });
  await (await app.browserWindow(page)).evaluate(w => {
    w.show();
    w.focus();
    w.webContents.focus();
  });
  return { app, page, data };
}
test("Argument dialogs target one block, run usable examples and clear on reopen or cancellation", async () => {
  test.setTimeout(180000);
  const { app, page, data } = await fixture();
  try {
    const before = JSON.parse(await fs.readFile(path.join(data, "settings.json"), "utf8")).code;
    for (const language of Object.keys(ARGUMENT_CODE) as ArgumentLanguage[]) {
      const sample = ARGUMENT_CODE[language],
        file = "参数-" + language + ".md",
        markdown = "```" + sample.language + " {id=0001}\n" + sample.code + "\n```\n\n```" + sample.language
          + " {id=0002}\n" + sample.code + "\n```\n";
      await page.evaluate(v => window.moyu!.create(v.file, "file", v.markdown), { file, markdown });
      await page.locator(".tree-item[title=\"" + file + "\"]").dblclick();
      const first = page.locator(".milkdown-code-block").nth(0), second = page.locator(".milkdown-code-block").nth(1);
      await first.locator(".cm-content").click({ button: "right" });
      await page.getByRole("menuitem", { name: "运行（参数）", exact: true }).click();
      let dialog = page.getByRole("dialog", { name: "运行（参数）", exact: true });
      await expect(dialog.getByLabel("新参数", { exact: true })).toHaveAttribute(
        "placeholder",
        ARGUMENT_VALUES[language][0],
      );
      await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), ARGUMENT_VALUES[language].join("\n"));
      await dialog.getByLabel("新参数", { exact: true }).press("Control+v");
      await expect(dialog.getByLabel("参数 1", { exact: true })).toHaveValue(ARGUMENT_VALUES[language][0]);
      if (language === "clang") await dialog.screenshot({ path: path.join(work, "arguments-v1816-dialog.png") });
      await dialog.getByRole("button", { name: "运行", exact: true }).click();
      await expect(first.locator(".code-result")).toContainText(sample.output, { timeout: 60000 });
      await second.getByRole("button", { name: "运行代码块", exact: true }).click();
      await expect(second.locator(".code-result")).toContainText(sample.output, { timeout: 60000 });
      await first.locator(".cm-content").click({ button: "right" });
      await page.getByRole("menuitem", { name: "运行（参数）", exact: true }).click();
      dialog = page.getByRole("dialog", { name: "运行（参数）", exact: true });
      await expect(dialog.getByLabel("参数 1", { exact: true })).toHaveCount(0);
      await expect(dialog.getByLabel("新参数", { exact: true })).toHaveValue("");
      await dialog.getByLabel("新参数", { exact: true }).fill("--price=20");
      await dialog.getByRole("button", { name: "添加参数", exact: true }).click();
      await dialog.getByLabel("新参数", { exact: true }).fill("--quantity=4");
      await dialog.getByLabel("新参数", { exact: true }).press("Enter");
      await dialog.getByLabel("新参数", { exact: true }).fill("--discount=0.75");
      await dialog.getByLabel("新参数", { exact: true }).press("Control+Enter");
      await expect(first.locator(".code-result")).toContainText("Total: 60.00", { timeout: 60000 });
      await first.locator(".cm-content").click({ button: "right" });
      await page.getByRole("menuitem", { name: "运行（参数）", exact: true }).click();
      dialog = page.getByRole("dialog", { name: "运行（参数）", exact: true });
      await dialog.getByLabel("新参数", { exact: true }).fill("discard");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await first.getByRole("button", { name: "运行代码块", exact: true }).click();
      await expect(first.locator(".code-result")).toContainText(sample.output, { timeout: 60000 });
    }
    expect(JSON.parse(await fs.readFile(path.join(data, "settings.json"), "utf8")).code).toEqual(before);
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    for (const name of ["C / C++", "C#", "Java", "Lua", "Ruby", "Bash"]) {
      await selectPreference(page,name);
      await expect(page.getByText("程序参数", { exact: true })).toHaveCount(0);
    }
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
test("Per-run argv preserves literal values in every argument-capable runtime and never leaks into the next run", async () => {
  test.setTimeout(120000);
  const { app, page } = await fixture();
  try {
    const args = ["中文", "a b", `a"b'c`, "", "a\\b", "line\nbreak"];
    const codes = {
      c: "#include <stdio.h>\nint main(int argc,char **argv){for(int i=1;i<argc;i++)printf(\"<%s>\\n\",argv[i]);return 0;}",
      cpp:
        "#include <stdio.h>\nint main(int argc,char **argv){for(int i=1;i<argc;i++)printf(\"<%s>\\n\",argv[i]);return 0;}",
      py: "import sys\nfor value in sys.argv[1:]:\n    print(\"<\" + value + \">\")",
      csharp:
        "public class Program {public static void Main(string[] args){foreach(string value in args)System.Console.WriteLine(\"<\"+value+\">\");}}",
      java:
        "public class Main {public static void main(String[] args){for(String value:args)System.out.println(\"<\"+value+\">\");}}",
      lua: "for _,value in ipairs(arg) do print(\"<\"..value..\">\") end",
      ruby: "ARGV.each { |value| puts \"<#{value}>\" }",
      bash: "for value in \"$@\"; do printf \"<%s>\\n\" \"$value\"; done",
    };
    for (const [language, code] of Object.entries(codes)) {
      for (const values of [args, []]) {
        const result: any = await page.evaluate(input => window.moyu!.feature("code.run", input), {
          language,
          code,
          arguments: values,
        });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        expect(result.data.error, JSON.stringify(result)).toBe("");
        expect(result.data.output, language).toBe(values.map(value => "<" + value + ">\n").join(""));
      }
    }
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
test("Argument editor handles empty values, edits, deletion, cancellation, paste boundaries and parameter limits", async () => {
  const { app, page } = await fixture();
  try {
    const file = "编辑参数.md", code = "import sys, json\nprint(json.dumps(sys.argv[1:], ensure_ascii=False))";
    await page.evaluate(v => window.moyu!.create(v.file, "file", "```py {id=0001}\n" + v.code + "\n```"), {
      file,
      code,
    });
    await page.locator(".tree-item[title=\"" + file + "\"]").dblclick();
    const block = page.locator(".milkdown-code-block");
    await block.locator(".cm-content").click({ button: "right" });
    await page.getByRole("menuitem", { name: "运行（参数）", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "运行（参数）", exact: true });
    await expect(dialog.getByLabel("新参数", { exact: true })).toBeFocused();
    await dialog.getByRole("button", { name: "添加参数", exact: true }).click();
    await dialog.getByLabel("新参数", { exact: true }).fill("a b");
    await dialog.getByRole("button", { name: "添加参数", exact: true }).click();
    await dialog.getByLabel("参数 2", { exact: true }).fill(" 中文 \" ");
    await dialog.getByRole("button", { name: "添加参数", exact: true }).click();
    await dialog.getByRole("button", { name: "删除参数 3", exact: true }).click();
    await dialog.getByRole("button", { name: "运行", exact: true }).click();
    await expect(block.locator(".code-result pre")).toContainText("[", { timeout: 30000 });
    expect(JSON.parse((await block.locator(".code-result pre").textContent())!)).toEqual(["", " 中文 \" "]);
    await block.locator(".cm-content").click({ button: "right" });
    await page.getByRole("menuitem", { name: "运行（参数）", exact: true }).click();
    const again = page.getByRole("dialog", { name: "运行（参数）", exact: true });
    await again.getByLabel("新参数", { exact: true }).fill("x".repeat(1001));
    await again.getByRole("button", { name: "运行", exact: true }).click();
    await expect(again.getByRole("alert")).toContainText("1000");
    await again.getByLabel("新参数", { exact: true }).fill("");
    await app.evaluate(({ clipboard }) => clipboard.writeText("x\n".repeat(64)));
    await again.getByLabel("新参数", { exact: true }).press("Control+v");
    await expect(again.getByLabel("参数 64", { exact: true })).toHaveCount(1);
    await expect(again.getByLabel("新参数", { exact: true })).not.toHaveAttribute("placeholder", /.+/);
    await expect(again.getByRole("button", { name: "添加参数", exact: true })).toBeDisabled();
    await again.getByLabel("新参数", { exact: true }).fill("extra");
    await again.getByRole("button", { name: "运行", exact: true }).click();
    await expect(again.getByRole("alert")).toContainText("64");
    await again.getByRole("button", { name: "取消", exact: true }).click();
    await expect(again).toHaveCount(0);
    await block.locator(".cm-content").click({ button: "right" });
    await page.getByRole("menuitem", { name: "运行（参数）", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "运行（参数）", exact: true }).getByLabel("参数 1", { exact: true }))
      .toHaveCount(0);
    await page.getByRole("dialog", { name: "运行（参数）", exact: true }).getByRole("button", {
      name: "取消",
      exact: true,
    }).click();
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});

test("Parameter menus match the language and work in reading; normal running and formatting stay separate", async () => {
  const { app, page } = await fixture();
  try {
    for (const language of ["js", "sql", "tabs"]) {
      const file = "菜单-" + language + ".md",
        source = language === "tabs" ? ":::py\nprint(1)" : language === "sql" ? "select 1;" : "console.log(1);";
      await page.evaluate(
        v =>
          window.moyu!.create(
            v.file,
            "file",
            "\x60\x60\x60" + v.language + " {id=0001}\n" + v.source + "\n\x60\x60\x60",
          ),
        { file, language, source },
      );
      await page.locator(".tree-item[title=\"" + file + "\"]").dblclick();
      await page.locator(".milkdown-code-block .cm-content").first().click({ button: "right" });
      await expect(page.getByRole("menuitem", { name: "运行（参数）", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
    const file = "阅读参数.md";
    await page.evaluate(
      file =>
        window.moyu!.create(file, "file", "\x60\x60\x60py {id=0001}\nimport sys\nprint(sys.argv[1:])\n\x60\x60\x60"),
      file,
    );
    await page.locator(".tree-item[title=\"" + file + "\"]").dblclick();
    await page.getByRole("button", { name: "阅读", exact: true }).click();
    await page.locator(".reading-view pre").first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "运行（参数）", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "运行（参数）", exact: true });
    await dialog.getByLabel("新参数", { exact: true }).fill("a b");
    await dialog.getByRole("button", { name: "运行", exact: true }).click();
    await expect(page.locator(".code-result")).toContainText("['a b']", { timeout: 30000 });
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(page.locator(".source-editor .cm-content")).not.toContainText("a b");
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
