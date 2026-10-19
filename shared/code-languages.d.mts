export type RuntimeKind = 'python' | 'javascript' | 'clang' | 'sql' | 'csharp' | 'java' | 'ruby' | 'bash' | 'lua';
export interface LanguageDefinition {
  label: string;
  kind: RuntimeKind;
  aliases: string[];
  format: boolean;
}
export function languageDefinition(language: string): LanguageDefinition | undefined;
export function canonicalLanguage(language: string): string;
export function formattable(language: string): boolean;
export function runnable(language: string): boolean;
export function runtimeKind(language: string): RuntimeKind | undefined;
export const formatterLanguages: string[];
