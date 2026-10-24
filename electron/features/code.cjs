const fs = require("node:fs/promises");
const path = require("node:path");
function createCodeOperations(services) {
  return {
    "code.run": async (input) => {
      const args = require("../../shared/runtime-arguments.mjs").argumentsFor(input.language, input.arguments);
      const current = services.codeData;
      if (input.root && input.root !== services.vault?.root) {
        throw new Error("知识库已切换。");
      }
      const context = await current.context(input);
      const result = await services.codeRunner.run({
        ...input,
        arguments: args,
        files: context.files,
        project: context.directory || "",
      });
      if (result.dataFiles && !context.memory) {
        try {
          const persisted = await current.persist(input, context, result.dataFiles);
          if (persisted) {
            context.files = persisted;
          }
        } catch (e) {
          result.error = [result.error, "数据文件未保存：" + e.message].filter(Boolean).join("\n");
        }
      }
      delete result.dataFiles;
      result.artifacts = (result.artifacts || []).map(artifact => {
        if (
          artifact.kind === "html" && !artifact.sandboxDocument
          || artifact.kind === "file" && /\.html?$/i.test(artifact.name)
        ) {
          const markup = Buffer.from(artifact.data || "", "base64").toString("utf8");
          const code = require("../html-results.cjs").htmlMarkupCode(markup);
          return {
            ...artifact,
            kind: "html",
            mime: "text/html",
            data: Buffer.from(require("../html-results.cjs").htmlDocument({ code })).toString("base64"),
          };
        }
        return artifact;
      });
      result.artifacts = services.resultStore.retain(result.artifacts);
      for (const [index, artifact] of result.artifacts.entries()) {
        if (artifact.kind === "html") {
          services.htmlResults.contexts.set(artifact.token, {
            current,
            input: {
              document: input.document,
              id: input.id,
              language: input.language,
              code: input.code,
              scope: input.scope,
            },
            context: { ...context, files: context.files.map(({ name, version }) => ({ name, version })) },
            queue: Promise.resolve(),
          });
          if (input.document && input.id) {
            Object.assign(artifact, await services.pinnedHTML.attach(artifact.token, index));
          }
        }
      }
      return result;
    },
    "code.result-page": (input) => services.resultStore.page(input.token, Number(input.page || 0)),
    "code.result-text": (input) => services.resultStore.text(input.token),
    "code.result-bytes": (input) =>
      input.preview ? services.resultStore.preview(input.token) : services.resultStore.read(input.token),
    "code.result-release": (input) => {
      services.htmlResults.release(input.tokens);
      return services.resultStore.release(input.tokens);
    },
    "code.html-url": (input) => services.htmlResults.open(input.token),
    "code.html-files": (input) => services.htmlResults.persist(input),
    "code.html-pin-state": (input) => services.pinnedHTML.state(input.token),
    "code.html-pin-recover": (input) => services.pinnedHTML.recover(input.token),
    "code.html-pin": (input) => services.pinnedHTML.pin(input),
    "code.html-resize": (input) => services.pinnedHTML.resize(input),
    "code.pinned-results": (input) => services.pinnedHTML.load(input),
    "code.data-list": (input) => services.codeData.list(input),
    "code.data-create": input => services.codeData.create(input),
    "code.data-upload": (input) => services.codeData.upload(input),
    "code.data-delete": (input) => services.codeData.remove(input),
    "code.data-rebind": (input) => services.codeData.rebind(input),
    "code.counter": (input) => services.attachments.documents.counter(input.document),
    "code.normalize": (input) => {
      if (input.root && input.root !== services.vault?.root) throw Error('知识库已切换。');
      return services.attachments.documents.sync(input.document, input.content, input.next);
    },
    "code.export": async (input) => {
      if (input.token) {
        input.bytes = await services.resultStore.read(input.token);
      }
      if (
        !ArrayBuffer.isView(input.bytes)
        || typeof input.name !== "string"
      ) {
        throw new Error("运行结果文件无效。");
      }
      const result = await services.dialog.showSaveDialog(services.window, {
        title: "保存运行结果",
        defaultPath: path.basename(input.name),
      });
      if (result.canceled) {
        return false;
      }
      await fs.writeFile(result.filePath, input.bytes);
      return true;
    },
  };
}
module.exports = { createCodeOperations };
