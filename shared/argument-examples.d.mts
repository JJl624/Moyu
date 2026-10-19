export type ArgumentLanguage = "python" | "clang" | "csharp" | "java" | "lua" | "ruby" | "bash";
export const ARGUMENT_VALUES: Readonly<Record<ArgumentLanguage, readonly string[]>>;
export const ARGUMENT_CODE: Readonly<
  Record<ArgumentLanguage, {
    language: string;
    purpose: string;
    output: string;
    code: string;
  }>
>;
