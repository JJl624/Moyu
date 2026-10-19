export function headingText(source) {
  return source.replace(/\\([\\`*_{}[\]()#+.!>~-])/g, (_m, character) => "&#" + character.codePointAt(0) + ";").replace(
    /(`+)(.*?)\1/g,
    (_m, _ticks, content) => content.replace(/[&<>*_`[\]~=]/g, character => "&#" + character.codePointAt(0) + ";"),
  ).replace(/<!--[\s\S]*?-->/g, "").replace(/!?(\[([^\]]+)\])\([^)]*\)/g, "$2").replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/<[^>]+>/g, "").replace(/`+([^`]+)`+/g, "$1").replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => a || b)
    .replace(/(?<!\w)_([^_]+)_(?!\w)|\*([^*]+)\*/g, (_m, a, b) => a || b).replace(
      /~~([^~]+)~~|==([^=]+)==/g,
      (_m, a, b) => a || b,
    ).replace(/\\([\\`*_{}[\]()#+.!>~-])/g, "$1").replace(
      /&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi,
      (whole, value) => {
        const names = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
        if (names[value]) return names[value];
        const point = value[1].toLowerCase() === "x" ? parseInt(value.slice(2), 16) : Number(value.slice(1));
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
      },
    ).trim();
}
export function documentHeadings(markdown) {
  const result = [];
  let offset = 0, fence = null, comment = false, html = "", pending = [], listIndent = 0;
  for (const raw of markdown.split("\n")) {
    let line = raw.replace(/\r$/, "").replace(/^ {0,3}(?:> ?)+/, "");
    const list = line.match(/^( *)(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/);
    if (list) {
      listIndent = list[0].length;
      line = line.slice(list[0].length);
    } else if (listIndent && /^ +/.test(line)) {
      const spaces = line.match(/^ */)[0].length;
      if (spaces >= listIndent) line = line.slice(listIndent);
    } else if (line.trim()) listIndent = 0;
    const position = offset;
    offset += raw.length + 1;
    if (comment) {
      if (line.includes("-->")) comment = false;
      pending = [];
      continue;
    }
    if (html) {
      if (html === "block" ? !line.trim() : new RegExp("</" + html + "\\s*>", "i").test(line)) html = "";
      pending = [];
      continue;
    }
    if (fence) {
      if (new RegExp("^ {0,3}" + fence.character + "{" + fence.length + ",}\\s*$").test(line)) fence = null;
      pending = [];
      continue;
    }
    const open = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (open) {
      fence = { character: open[1][0], length: open[1].length };
      pending = [];
      continue;
    }
    if (/^\s*<!--/.test(line)) {
      comment = !line.includes("-->");
      pending = [];
      continue;
    }
    const tag = line.match(/^ {0,3}<(script|style|pre|textarea|div|table|section|article|p)(?:\s|>)/i);
    if (tag) {
      html = ["script", "style", "pre", "textarea"].includes(tag[1].toLowerCase()) ? tag[1].toLowerCase() : "block";
      if (new RegExp("</" + tag[1] + "\\s*>", "i").test(line)) html = "";
      pending = [];
      continue;
    }
    const atx = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/);
    if (atx) {
      result.push({
        text: headingText((atx[2] || "").replace(/[ \t]+#+[ \t]*$/, "")),
        level: atx[1].length,
        offset: position,
      });
      pending = [];
      continue;
    }
    const underline = line.match(/^ {0,3}(=+|-+)\s*$/);
    if (underline && pending.length) {
      result.push({
        text: headingText(pending.map(p => p.text).join(" ")),
        level: underline[1][0] === "=" ? 1 : 2,
        offset: pending[0].offset,
      });
      pending = [];
      continue;
    }
    if (!line.trim() || /^ {4}|^\t|^ {0,3}(?:[-*_] *){3,}$|^\s*\||^\s*[>]/.test(line)) {
      pending = [];
      continue;
    }
    pending.push({ text: line.trim(), offset: position });
  }
  return result;
}
export function headingTree(headings) {
  const roots = [], stack = [];
  for (const [index, heading] of headings.entries()) {
    while (stack.length && stack.at(-1).level >= heading.level) stack.pop();
    const node = { ...heading, index, depth: stack.length, children: [] };
    (stack.at(-1)?.children || roots).push(node);
    stack.push(node);
  }
  return roots;
}
