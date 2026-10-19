// Read the public version export without evaluating a downloaded loader.
function pyodideVersion(source) {
  if (source.length < 1000 || !source.includes("loadPyodide")) throw Error("请选择 pyodide.mjs 加载器");
  let name = [...source.matchAll(/([A-Za-z_$][\w$]*)\s+as\s+version\b/g)].at(-1)?.[1] || "version";
  for (let depth = 0; depth < 8; depth++) {
    const escaped = name.replaceAll("$", "\\$");
    const match = source.match(
      new RegExp("(?<![\\w$])" + escaped + "\\s*=\\s*(?:[\"'](\\d+\\.\\d+\\.\\d+)[\"']|([A-Za-z_$][\\w$]*))"),
    );
    if (match?.[1]) return match[1];
    if (!match?.[2] || match[2] === name) break;
    name = match[2];
  }
  throw Error("无法识别 Pyodide 版本，请手动选择对应版本");
}
module.exports = { pyodideVersion };
