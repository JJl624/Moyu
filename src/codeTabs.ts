export interface CodeTab {
  language: string;
  title: string;
  declarationFrom: number | null;
  declarationTo: number;
  from: number;
  to: number;
  sectionTo: number;
  code: string;
}
export const isTabbedCode = (language: string) => language.toLowerCase() === 'tabs';
const declaration = /^:::(?:([^\s:]+)(?:[ \t]+(.*))?)?[ \t]*$/;
export function parseCodeTabs(source: string): CodeTab[] {
  const headers: { from: number; to: number; body: number; language: string; title: string }[] = [];
  for (const line of source.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)) {
    if (!line[0]) continue;
    const value = line[0].replace(/[\r\n]+$/, ''), match = declaration.exec(value);
    if (match) {
      headers.push({
        from: line.index!,
        to: line.index! + value.length,
        body: line.index! + line[0].length,
        language: match[1] || '',
        title: (match[2] || '').trim(),
      });
    }
  }
  const tabs: CodeTab[] = [];
  const preambleEnd = headers[0]?.from ?? source.length;
  if (source.slice(0, preambleEnd).trim()) {
    tabs.push({
      language: 'text',
      title: '未分组代码',
      declarationFrom: null,
      declarationTo: 0,
      from: 0,
      to: preambleEnd,
      sectionTo: preambleEnd,
      code: source.slice(0, preambleEnd),
    });
  }
  headers.forEach((header, index) => {
    const end = headers[index + 1]?.from ?? source.length;
    let to = end;
    if (headers[index + 1] && to > header.body) {
      if (source[to - 1] === '\n') {
        to--;
        if (source[to - 1] === '\r') to--;
      } else if (source[to - 1] === '\r') to--;
    }
    tabs.push({
      language: header.language,
      title: header.title,
      declarationFrom: header.from,
      declarationTo: header.to,
      from: header.body,
      to,
      sectionTo: end,
      code: source.slice(header.body, to),
    });
  });
  return tabs;
}
export function replaceTabCode(source: string, index: number, code: string) {
  const tab = parseCodeTabs(source)[index];
  if (!tab) return source;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const separator = tab.declarationFrom !== null && tab.from === tab.declarationTo && code
    ? newline
    : '';
  const after = tab.sectionTo < source.length && tab.to === tab.sectionTo && code
      && (tab.declarationFrom !== null || !/[\r\n]$/.test(code))
    ? newline
    : '';
  return source.slice(0, tab.from) + separator + code + after + source.slice(tab.to);
}
export function renameCodeTab(
  source: string,
  index: number,
  language: string,
  title: string,
): string | null {
  const tab = parseCodeTabs(source)[index];
  if (!tab || tab.declarationFrom === null || language && !/^[^\s:]+$/.test(language)) return null;
  return source.slice(0, tab.declarationFrom) + ':::' + (language || (title.trim() ? 'text' : ''))
    + (title.trim() ? ' ' + title.trim().replace(/[\r\n]/g, '') : '')
    + source.slice(tab.declarationTo);
}
export function appendCodeTab(source: string, language = 'text', title = '') {
  if (language && !/^[^\s:]+$/.test(language)) return source;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const tabs = parseCodeTabs(source), last = tabs[tabs.length - 1];
  const separator =
    source && (!/[\r\n]$/.test(source) || last?.declarationFrom !== null && last?.code)
      ? newline
      : '';
  return source + separator + ':::' + (language || (title.trim() ? 'text' : ''))
    + (title.trim() ? ' ' + title.trim().replace(/[\r\n]/g, '') : '') + newline;
}
export function createCodeTab(source: string) {
  const titles = new Set(parseCodeTabs(source).map(tab => tab.title));
  let number = 1;
  while (titles.has(`标签页 ${number}`)) number++;
  return appendCodeTab(source, 'text', `标签页 ${number}`);
}
export function removeCodeTab(source: string, index: number) {
  const tabs = parseCodeTabs(source), tab = tabs[index], previous = tabs[index - 1];
  if (
    tab && tab.declarationFrom !== null && tab.sectionTo === source.length
    && previous?.declarationFrom !== null && previous
  ) return source.slice(0, previous.to);
  return tab?.declarationFrom !== null && tab
    ? source.slice(0, tab.declarationFrom) + source.slice(tab.sectionTo)
    : source;
}
export function moveCodeTab(source: string, index: number, direction: -1 | 1) {
  const tabs = parseCodeTabs(source), a = tabs[index], b = tabs[index + direction];
  if (!a || !b || a.declarationFrom === null || b.declarationFrom === null) return source;
  const first = direction === 1 ? a : b, last = direction === 1 ? b : a;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const section = (tab: CodeTab, final: boolean) =>
    source.slice(tab.declarationFrom!, tab.declarationTo)
    + (source.slice(tab.declarationTo, tab.from) || (tab.code || !final ? newline : '')) + tab.code
    + (!final && tab.code ? newline : '');
  return source.slice(0, first.declarationFrom!) + section(last, false)
    + section(first, last.sectionTo === source.length) + source.slice(last.sectionTo);
}
export function tabAtOffset(tabs: CodeTab[], offset: number, preferred?: number) {
  const current = preferred === undefined ? undefined : tabs[preferred];
  if (current && current.from <= offset && offset <= current.to) return preferred!;
  for (let i = tabs.length - 1; i >= 0; i--) {
    if ((tabs[i].declarationFrom ?? tabs[i].from) <= offset) return i;
  }
  return 0;
}
