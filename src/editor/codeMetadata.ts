import {codeId,withAttribute} from '../../shared/code-documents.mjs';
const tokens = /(?:[^\s"'{}]+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')+/g;
function groupRanges(meta: string) {
  const ranges: { from: number; to: number }[] = [];
  let quote = '', start = -1, depth = 0;
  for (let i = 0; i < meta.length; i++) {
    const char = meta[i];
    if (char === '\\') {
      i++;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') {
      if (!depth) start = i;
      depth++;
    } else if (char === '}' && depth && !--depth) ranges.push({ from: start, to: i + 1 });
  }
  return ranges;
}
export function attributeGroups(meta: string) {
  meta=withAttribute(meta,'id','');
  const groups = groupRanges(meta);
  if (!groups.some(({ from, to }) => meta.slice(from + 1, to - 1).trim())) return '';
  return groups.map(({ from, to }) => meta.slice(from, to)).join(' ');
}
export function withAttributeGroups(meta: string, value: string): string | null {
  const groups = groupRanges(value);
  let end = 0;
  for (const group of groups) {
    if (value.slice(end, group.from).trim()) return null;
    end = group.to;
  }
  if (value.slice(end).trim()) return null;
  const previous = groupRanges(meta);
  if (!previous.length) return meta + (value.trim() ? (meta ? ' ' : '') + value.trim() : '');
  let result = '', index = 0;
  end = 0;
  for (const group of previous) {
    const outside = meta.slice(end, group.from);
    result += outside;
    if (groups[index]) result += value.slice(groups[index].from, groups[index].to);
    else if (result.endsWith(' ') && meta[group.to] === ' ') result = result.slice(0, -1);
    index++;
    end = group.to;
  }
  result += meta.slice(end);
  for (; index < groups.length; index++) {
    result += (result ? ' ' : '') + value.slice(groups[index].from, groups[index].to);
  }
  const id=codeId(meta);return id?withAttribute(result.trim(),'id',id):result.trim();
}
export function attributeFromMeta(meta: string, key: string): string | null {
  for (const { from, to } of groupRanges(meta)) {
    const parts = meta.slice(from + 1, to - 1).match(tokens) || [];
    for (let i = 0; i < parts.length; i++) {
      let token = parts[i];
      if (token === key && parts[i + 1] === '=') token += '=' + parts[i + 2];
      else if (token === key + '=') token += parts[i + 1];
      if (token.startsWith(key + '=')) {
        const value = token.slice(key.length + 1);
        return value.replace(/^(["'])(.*)\1$/, '$2');
      }
    }
  }
  return null;
}
function heights(group: string) {
  const parts = [...group.matchAll(tokens)],
    found: { from: number; to: number; value: number | null }[] = [];
  const isValue = (token: string | undefined) => !!token && !/^[.#]|^[^"']*=/.test(token);
  for (let i = 0; i < parts.length; i++) {
    let candidate = parts[i][0], last = i;
    if (candidate === 'height' && parts[i + 1]?.[0] === '=') {
      last = i + 1;
      if (isValue(parts[i + 2]?.[0])) last++;
      candidate += '=' + (last === i + 2 ? parts[last][0] : '');
    } else if (candidate === 'height=' && isValue(parts[i + 1]?.[0])) {
      last = i + 1;
      candidate += parts[last][0];
    }
    if (!candidate.startsWith('height=')) continue;
    const raw = candidate.slice(7).replace(/^(["'])(.*)\1$/, '$2'),
      number = /^\d+(?:\.\d+)?(?:px)?$/i.test(raw) ? Number(raw.replace(/px$/i, '')) : NaN;
    found.push({
      from: parts[i].index!,
      to: (parts[last] || parts[i]).index! + (parts[last] || parts[i])[0].length,
      value: Number.isFinite(number) ? number : null,
    });
    i = last;
  }
  return found;
}
export function heightFromMeta(meta: string): number | null {
  for (const { from, to } of groupRanges(meta)) {
    for (const { value } of heights(meta.slice(from, to))) {
      if (value !== null) return Math.max(60, Math.min(4000, value));
    }
  }
  return null;
}
export function withHeight(meta: string, height: number | null): string {
  if (height !== null && !Number.isFinite(height)) return meta;
  const groups = groupRanges(meta),
    value = height === null ? null : Math.round(Math.max(60, Math.min(4000, height)));
  const matches = groups.flatMap(group =>
    heights(meta.slice(group.from, group.to)).map(match => ({
      ...match,
      from: group.from + match.from,
      to: group.from + match.to,
    }))
  );
  if (!matches.length) {
    if (value === null) return meta;
    const group = groups[0];
    return group
      ? meta.slice(0, group.to - 1) + (meta[group.to - 2] === '{' ? '' : ' ') + 'height=' + value
        + meta.slice(group.to - 1)
      : meta + (meta ? ' ' : '') + '{height=' + value + '}';
  }
  let end = 0, clean = '';
  matches.forEach((match, index) => {
    let from = match.from, to = match.to;
    if (value === null || index > 0) {
      if (meta[from - 1] === ' ') from--;
      else if (meta[to] === ' ') to++;
      if (from < end && meta[to] === ' ') to++;
    }
    clean += meta.slice(end, Math.max(end, from))
      + (index === 0 && value !== null ? 'height=' + value : '');
    end = to;
  });
  clean += meta.slice(end);
  // Only groups emptied by removing height are dropped. Other tokens keep their order and spelling.
  for (const group of groupRanges(clean).reverse()) {
    if (!clean.slice(group.from + 1, group.to - 1).trim()) {
      clean = clean.slice(0, group.from) + clean.slice(group.to);
    }
  }
  return clean.trim();
}
