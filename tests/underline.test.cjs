const { test } = require("node:test"), assert = require("node:assert/strict");
const { buildSync } = require("esbuild"), Module = require("node:module"), path = require("node:path");
const bundled =
  buildSync({
    entryPoints: [path.resolve(__dirname, "../src/inlineSyntax.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
  }).outputFiles[0].text;
const mod = new Module(__filename, module);
mod.filename = __filename;
mod.paths = module.paths;
mod._compile(bundled, __filename);
const { parseInline, inlineRaw, sourceInlineTree } = mod.exports;
function types(nodes) {
  return nodes.flatMap(node => [node.type, ...types(node.children || [])]);
}
test("Double underscores render underline with exact editable source, including adjacent Chinese text and nested styles", () => {
  for (
    const raw of [
      "__下划线__",
      "前__文字__后",
      "__中文 😀__",
      "__第一行\n第二行__",
      "__**加粗** 与 *斜体*__",
      "[__链接__](a.md)",
      "==__高亮下划线__==",
      "___斜体下划线___",
    ]
  ) {
    const parsed = parseInline(raw);
    assert(parsed?.decorated, raw);
    assert(types(parsed.nodes).includes("underline"), raw);
    const walk = node => {
      if (node.type === "underline") {
        assert.equal(raw.slice(node.position.start.offset, node.position.end.offset), inlineRaw(node, raw));
      }
      node.children?.forEach(walk);
    };
    parsed.nodes.forEach(walk);
    const tree = { type: "paragraph", children: parsed.nodes };
    sourceInlineTree(tree, raw);
    assert(tree.children.some(node => node.type === "inlineSource"), raw);
  }
  assert.deepEqual(types(parseInline("__**加粗**__").nodes), ["underline", "strong", "text"]);
  assert.deepEqual(types(parseInline("**__下划线__**").nodes), ["strong", "underline", "text"]);
  assert.equal(parseInline("__一__ __二__").nodes.filter(node => node.type === "underline").length, 2);
});
test("Underline preserves escapes, code spans, unclosed text, single-underscore italics and asterisk bold", () => {
  for (const raw of ["\\__普通文字__", "`__代码__`", "__ 没有闭合", "__开头", "结尾__", "____", "__末尾 __"]) {
    assert(!types(parseInline(raw).nodes).includes("underline"), raw);
  }
  assert.deepEqual(types(parseInline("_斜体_ **加粗**").nodes), ["emphasis", "text", "text", "strong", "text"]);
  assert(types(parseInline("___斜体下划线___").nodes).includes("emphasis"));
});
test("Underline reading output uses u and preserves link/code and sanitization boundaries", async () => {
  const { unified } = await import("unified"),
    { default: parse } = await import("remark-parse"),
    { default: underline } = await import("../shared/remark-underline.mjs"),
    { default: highlight } = await import("../shared/remark-highlight.mjs"),
    { default: rehype } = await import("remark-rehype"),
    { default: sanitize, defaultSchema } = await import("rehype-sanitize"),
    { default: stringify } = await import("rehype-stringify");
  const render = async value =>
    String(
      await unified().use(parse).use(highlight).use(underline).use(rehype).use(sanitize, {
        ...defaultSchema,
        tagNames: [...defaultSchema.tagNames, "u", "mark"],
      }).use(stringify).process(value),
    );
  assert.equal(
    await render("前__文字__后 __**加粗**__ __[链接](https://example.com)__ `__代码__`"),
    "<p>前<u>文字</u>后 <u><strong>加粗</strong></u> <u><a href=\"https://example.com\">链接</a></u> <code>__代码__</code></p>",
  );
  assert.equal(await render("__<script>alert(1)</script>__"), "<p><u>alert(1)</u></p>");
});
