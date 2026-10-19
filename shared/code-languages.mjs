const definitions = [
  { label: 'Python', kind: 'python', aliases: ['py', 'python'], format: true },
  { label: 'TypeScript', kind: 'javascript', aliases: ['ts', 'typescript'], format: true },
  { label: 'JavaScript', kind: 'javascript', aliases: ['js', 'javascript'], format: true },
  { label: 'C', kind: 'clang', aliases: ['c'], format: true },
  { label: 'C++', kind: 'clang', aliases: ['cpp', 'c++', 'cc', 'cxx'], format: true },
  { label: 'SQL', kind: 'sql', aliases: ['sql', 'sqlite'], format: true },
  { label: 'C#', kind: 'csharp', aliases: ['cs', 'csharp', 'c#'], format: true },
  { label: 'Java', kind: 'java', aliases: ['java'], format: true },
  { label: 'Ruby', kind: 'ruby', aliases: ['ruby', 'rb'], format: false },
  { label: 'Bash', kind: 'bash', aliases: ['bash', 'sh', 'shell'], format: false },
  { label: 'Lua', kind: 'lua', aliases: ['lua'], format: true },
];
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matchers = definitions.map(definition => ({
  definition,
  pattern: new RegExp('^(?:' + definition.aliases.map(escape).join('|') + ')$', 'i'),
}));
const aliases = new Map(definitions.flatMap(definition => definition.aliases.map(alias => [alias, definition])));

export function languageDefinition(language) {
  if (typeof language === 'string') return aliases.get(language.toLowerCase());
  return matchers.find(entry => entry.pattern.test(language))?.definition;
}
export function canonicalLanguage(language) {
  return languageDefinition(language)?.label ?? language.toLowerCase();
}
export function formattable(language) {
  return languageDefinition(language)?.format === true;
}
export function runnable(language) {
  return !!languageDefinition(language);
}
export function runtimeKind(language) {
  return /^clang$/i.test(language) ? 'clang' : languageDefinition(language)?.kind;
}
export const formatterLanguages = definitions.filter(d => d.format).flatMap(d => d.aliases);
