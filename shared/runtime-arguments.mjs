import { runtimeKind } from "./code-languages.mjs";
export function supportsRunArguments(language) {
  return ["python", "clang", "lua", "csharp", "java", "ruby", "bash"].includes(runtimeKind(language));
}
export function runArguments(value) {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) || value.length > 64
    || Array.from(value).some(argument => typeof argument !== "string" || argument.length > 1000 || argument.includes("\0"))
  ) throw Error("参数最多 64 个，每个不超过 1000 个字符，且不能包含空字节（NUL）。");
  return [...value];
}
export function pastedArguments(text) {
  if (!text) return [];
  const values = String(text).split(/\r\n|\n|\r/);
  if (values.length > 1 && values.at(-1) === "") values.pop();
  return runArguments(values);
}

export function argumentsFor(language, value) {
  const args = runArguments(value);
  if (args.length && !supportsRunArguments(String(language))) throw Error("该语言不支持程序参数。");
  return args;
}
