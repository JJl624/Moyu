const fs = require("node:fs/promises");
const path = require("node:path");
const { fault, hash } = require("./vault.cjs");
const { MAX, snapshot, replace, atomic } = require("./files.cjs");
const isDrawing = (p) => typeof p === "string" && /\.excalidraw$/i.test(p);
function validate(content) {
  if (typeof content !== "string" || Buffer.byteLength(content) > MAX)
    throw fault("绘图文件超过 20 MB。");
  const scene = JSON.parse(content);
  if (
    scene.type !== "excalidraw" ||
    !Array.isArray(scene.elements) ||
    scene.elements.length > 30000 ||
    !scene.files ||
    typeof scene.files !== "object"
  )
    throw fault("Excalidraw 文件格式无效。");
  return content;
}
class Drawings {
  constructor(vault) {
    this.vault = vault;
    this.library = new (require('./drawing-library.cjs').DrawingLibrary)(vault);
  }
  async read(p) {
    if (!isDrawing(p)) throw fault("请选择 .excalidraw 文件。");
    const file = await snapshot(this.vault, p);
    if (!file) throw fault("绘图文件不存在。");
    const content = validate(file.bytes.toString("utf8"));
    return { path: p, content, version: file.version, updated: file.updated };
  }
  create(input) {
    return this.vault.mutate(async () => {
      if (!isDrawing(input.path))
        throw fault("绘图文件需要 .excalidraw 扩展名。");
      const content = validate(
        input.content ||
          JSON.stringify({
            type: "excalidraw",
            version: 2,
            source: "Moyu",
            elements: [],
            appState: { viewBackgroundColor: "#ffffff" },
            files: {},
          }),
      );
      await replace(this.vault, input.path, Buffer.from(content), null);
      return this.read(input.path);
    });
  }
  save(input) {
    return this.vault.mutate(async () => {
      const current = await this.read(input.path);
      if (current.version !== input.version)
        throw fault(
          "磁盘上的绘图已变化，请选择使用磁盘版本、保留当前版本或另存。",
          "CONFLICT",
          current,
        );
      const content = validate(input.content);
      if (hash(content) !== current.version)
        await replace(
          this.vault,
          input.path,
          Buffer.from(content),
          current.version,
        );
      return this.read(input.path);
    });
  }
  image(input) {
    return this.vault.mutate(async () => {
      if (
        !isDrawing(input.path) ||
        !["png", "svg"].includes(input.format) ||
        !ArrayBuffer.isView(input.bytes) ||
        input.bytes.byteLength > MAX
      )
        throw fault("绘图导出格式无效。");
      await this.vault.resolve(input.path);
      const {Attachments}=require('./attachments.cjs');
      const result=await new Attachments(this.vault).put(input.document||input.path,path.basename(input.path)+'.'+input.format,input.bytes);
      return {path:result.path,source:input.path};
    });
  }
}
module.exports = { Drawings };
