import gfm from "remark-gfm";
import parse from "remark-parse";
import { unified } from "unified";
const parser = unified().use(parse).use(gfm);
const tokens = /(?:[^\s"'{}]+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')+/g;
export function groups(meta) {
  const out = [];
  let quote = "", start = -1, depth = 0;
  for (let i = 0; i < meta.length; i++) {
    const c = meta[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === "\"" || c === "'") {
      quote = c;
      continue;
    }
    if (c === "{") {
      if (!depth) start = i;
      depth++;
    } else if (c === "}" && depth && !--depth) out.push({ from: start, to: i + 1 });
  }
  return out;
}
function attributes(meta, key) {
  return groups(meta).flatMap(group => {
    const parts = [...meta.slice(group.from + 1, group.to - 1).matchAll(tokens)], out = [];
    for (let i = 0; i < parts.length; i++) {
      let token = parts[i][0], last = i;
      if (token === key && parts[i + 1]?.[0] === "=") {
        last = i + 2;
        token += "=" + (parts[last]?.[0] || "");
      } else if (token === key + "=") {
        last = i + 1;
        token += parts[last]?.[0] || "";
      }
      if (token.startsWith(key + "=")) {
        out.push({
          from: group.from + 1 + parts[i].index,
          to: group.from + 1 + (parts[last] || parts[i]).index
            + (parts[last] || parts[i])[0].length,
          value: token.slice(key.length + 1).replace(/^(["'])(.*)\1$/, "$2"),
        });
        i = last;
      }
    }
    return out;
  });
}
export const attribute = (meta, key) => attributes(meta || "", key)[0]?.value || "";
export const codeId = meta =>
  /^[0-9a-f]{4}$/i.test(attribute(meta, "id")) && attribute(meta, "id") !== "0000"
    ? attribute(meta, "id").toLowerCase()
    : "";
export function withAttribute(meta, key, value) {
  const matches = attributes(meta, key);
  if (!matches.length) {
    if (!value) return meta;
    const group = groups(meta)[0];
    return group
      ? meta.slice(0, group.to - 1) + (meta[group.to - 2] === "{" ? "" : " ") + key + "=" + value
        + meta.slice(group.to - 1)
      : (meta ? meta + " " : "") + "{" + key + "=" + value + "}";
  }
  let out = "", end = 0;
  matches.forEach((m, i) => {
    let from = m.from, to = m.to;
    if (i || !value) {
      if (meta[from - 1] === " ") from--;
      else if (meta[to] === " ") to++;
    }
    out += meta.slice(end, Math.max(end, from)) + (!i && value ? key + "=" + value : "");
    end = to;
  });
  out += meta.slice(end);
  for (const g of groups(out).reverse()) {
    if (!out.slice(g.from + 1, g.to - 1).trim()) out = out.slice(0, g.from) + out.slice(g.to);
  }
  return out.trim();
}
export function codeInfo(node) {
  const language = node.lang || "", meta = node.meta || "";
  return language.startsWith("{")
    ? { language: "", meta: language + (meta ? " " + meta : "") }
    : { language, meta };
}
export function parseBlocks(content) {
  const result = [];
  const visit = node => {
    if (node.type === "code") {
      const start = node.position.start.offset, end = node.position.end.offset;
      const opening = content.slice(start, end).match(/^(`{3,}|~{3,})([^\r\n]*)/);
      if (opening && start + opening[0].length < end) {
        const info = codeInfo(node);
        result.push({
          language: info.language,
          code: node.value || "",
          meta: info.meta,
          id: codeId(info.meta),
          start,
          end,
          headerEnd: start + opening[0].length,
          fence: opening[1],
        });
      }
    }
    node.children?.forEach(visit);
  };
  visit(parser.parse(content));
  return result;
}
export function normalizeIds(content, floor = 1) {
  const blocks = parseBlocks(content), seen = new Set(), edits = [];
  if (!Number.isInteger(floor) || floor < 1 || floor > 65536) {
    throw new Error("代码块 ID 计数无效。");
  }
  let exhausted = false;
  let next = blocks.reduce((n, b) => Math.max(n, b.id ? parseInt(b.id, 16) + 1 : 1), floor);
  for (const block of blocks) {
    let id = block.id;
    if (!id || seen.has(id)) {
      if (next > 0xffff) { exhausted = true; id = ''; }
      else id = (next++).toString(16).padStart(4, "0");
    }
    const meta = withAttribute(block.meta, "id", id);
    if (meta !== block.meta || !block.language) {
      const before = content.slice(block.start, block.headerEnd),
        after = block.fence + (block.language || "text") + " " + meta;
      let prefix = 0, suffix = 0;
      while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
        prefix++;
      }
      while (
        suffix < before.length - prefix && suffix < after.length - prefix
        && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
      ) suffix++;
      edits.push({
        from: block.start + prefix,
        to: block.headerEnd - suffix,
        insert: after.slice(prefix, after.length - suffix),
      });
    }
    if(id)seen.add(id);
  }
  for (const e of [...edits].reverse()) {
    content = content.slice(0, e.from) + e.insert + content.slice(e.to);
  }
  return { content, next, edits, ...(exhausted ? { exhausted: true } : {}) };
}
