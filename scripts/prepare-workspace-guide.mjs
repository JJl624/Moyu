import fs from "node:fs/promises";
import path from "node:path";
import { normalizeIds, parseBlocks } from "../shared/code-documents.mjs";
import {languageGuideRecords} from './prepare-language-guides.mjs';
const root = path.resolve(import.meta.dirname, "../resources/workspace-guide"),
  document = "公式和代码示例.md",
  file = path.join(root, document);
for (const name of await fs.readdir(root)) {
  if (!name.endsWith(".md")) continue;
  const target = path.join(root, name), before = await fs.readFile(target, "utf8");
  const content = normalizeIds(before).content;
  if (content !== before) await fs.writeFile(target, content);
}
const normalized = normalizeIds(await fs.readFile(file, "utf8"));
await fs.writeFile(file, normalized.content);
const blocks = parseBlocks(normalized.content),
  fixtures = [["from helper import twice", "Python", {
    "input.json": "[2, 4, 6, 8]",
    "helper.py": "def twice(value):\n    return value * 2\n",
  }], ["#include \"util.h\"", "C", {
    "util.h": "int twice(int value);\n",
    "util.c": "#include \"util.h\"\nint twice(int value) { return value * 2; }\n",
    "stdin.txt": "21\n",
  }], ["#include \"helper.hpp\"", "C++", {
    "helper.hpp": "int twice_cpp(int value);\n",
    "helper.cpp": "#include \"helper.hpp\"\nint twice_cpp(int value) { return value * 2; }\n",
    "stdin.txt": "21\n",
  }], ["local calc = require('calc')", "Lua", {
    "calc.lua": "return { twice = function(value) return value * 2 end }\n",
    "stdin.txt": "21\n",
  }], ["Helper.Twice", "C#", {
    "Helper.cs": "public static class Helper { public static int Twice(int value) => value * 2; }\n",
    "stdin.txt": "21\n",
  }], ["Helper.twice", "Java", {
    "Helper.java": "public class Helper { public static int twice(int value) { return value * 2; } }\n",
  }], ["require_relative \"helper\"", "Ruby", {
    "helper.rb": "module Helper\n  def self.twice(value)\n    value * 2\n  end\nend\n",
    "stdin.txt": "21\n",
  }], ["source helper.sh", "Bash", {
    "helper.sh": "twice() { echo \"$(( $1 * 2 ))\"; }\n",
    "stdin.txt": "21\n",
  }]];
for (const [match, , files] of fixtures) {
  const block = blocks.find(b => b.code.includes(match));
  if (!block) throw new Error("Missing fixture block " + match);
  const directory = path.join(root, "公式和代码示例.assets/code-data", block.id);
  await fs.mkdir(directory, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(directory, name), content);
  }
}
await fs.mkdir(path.join(root, "公式和代码示例.assets/attachments"), { recursive: true });
const registry = {
  version: 2,
  documents: {
    ...Object.fromEntries(languageGuideRecords.filter(r=>r.blocks.length).map(r=>[r.doc,{nextId:r.nextId,directory:r.doc.replace(/\.md$/,'.assets'),blocks:r.blocks}])),
    [document]: {
      nextId: normalized.next,
      directory: "公式和代码示例.assets",
      blocks: blocks.map(b => b.id).sort(),
    },
  },
};
await fs.mkdir(path.join(root, ".data"), { recursive: true });
await fs.writeFile(
  path.join(root, ".data/document_map.json"),
  JSON.stringify(registry, null, 2),
);
console.log("Guide blocks:", blocks.length, "seeded:", fixtures.length);

await fs.writeFile(
  path.join(root, "公式和代码示例.assets/document.json"),
  JSON.stringify(
    {
      version: 2,
      document,
      nextId: normalized.next,
      blocks: registry.documents[document].blocks,
    },
    null,
    2,
  ),
);
