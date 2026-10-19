// Ignore comments and literals before inspecting declarations. Offsets and newlines
// are preserved, including C++ raw strings and continued preprocessor directives.
function maskedSource(source) {
  const chars = source.split('');
  const mask = (from, to) => { for (let i = from; i < to; i++) if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' '; };
  for (let i = 0; i < source.length;) {
    let end;
    if (source.startsWith('//', i)) {
      end = source.indexOf('\n', i + 2);
      while (end >= 0 && /\\\r?$/.test(source.slice(i, end))) end = source.indexOf('\n', end + 1);
      if (end < 0) end = source.length;
    }
    else if (source.startsWith('/*', i)) { end = source.indexOf('*/', i + 2); end = end < 0 ? source.length : end + 2; }
    else if (source.startsWith('R"', i)) {
      const open = source.indexOf('(', i + 2), delimiter = source.slice(i + 2, open);
      if (open > i && delimiter.length <= 16 && !/[\s()\\]/.test(delimiter)) {
        end = source.indexOf(')' + delimiter + '"', open + 1);
        end = end < 0 ? source.length : end + delimiter.length + 2;
      }
    } else if (source[i] === '"' || (source[i] === "'" && !(/[\da-fA-F]/.test(source[i - 1] || '') && /[\da-fA-F]/.test(source[i + 1] || '')))) {
      const quote = source[i]; end = i + 1;
      while (end < source.length) { if (source[end] === '\\') { end += 2; continue; } if (source[end++] === quote) break; }
    }
    if (end !== undefined) { mask(i, end); i = end; } else i++;
  }
  return chars.join('');
}
function directives(source, masked) {
  const ranges = [];
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) || [];
  let offset = 0, active = null;
  for (const line of lines) {
    const text = masked.slice(offset, offset + line.length);
    if (active !== null || /^\s*#/.test(text)) {
      if (active === null) active = offset;
      if (!/\\\r?\n$/.test(line)) { ranges.push([active, offset + line.length]); active = null; }
    }
    offset += line.length;
  }
  if (active !== null) ranges.push([active, source.length]);
  return ranges;
}
function blankRanges(source, ranges) {
  const chars = source.split('');
  for (const [start, end] of ranges) for (let i = start; i < end; i++) if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
  return chars.join('');
}
function tokens(source) { return [...source.matchAll(/[a-zA-Z_$][\w$]*|[^\s]/g)].map(match => ({ text: match[0], from: match.index, to: match.index + match[0].length })); }
function pair(tokens, index, open, close) {
  let depth = 0;
  for (let i = index; i < tokens.length; i++) { if (tokens[i].text === open) depth++; else if (tokens[i].text === close && --depth === 0) return i; }
  return -1;
}
function analyze(source) {
  const masked = maskedSource(source), preprocessor = directives(source, masked);
  const scan = tokens(blankRanges(masked, preprocessor));
  let depth = 0;
  const functions = [];
  for (let i = 0; i < scan.length; i++) {
    const token = scan[i];
    if (depth === 0 && token.text === 'main' && scan[i + 1]?.text === '(') {
      const end = pair(scan, i + 1, '(', ')');
      // A prototype or call is not an entry point. Permit attributes and noexcept.
      for (let j = end + 1; end >= 0 && j < scan.length; j++) {
        if ([';', '=', ','].includes(scan[j].text)) break;
        if (scan[j].text === '{') return { main: true, preprocessor, functions };
      }
    }
    if (token.text === '{') {
      if (depth === 0 && scan[i - 1]?.text === ')') {
        const end = pair(scan, i, '{', '}');
        let start = i - 1;
        while (start > 0 && ![';', '}', '{'].includes(scan[start - 1].text)) start--;
        const prefix = scan.slice(start, i);
        // Lift ordinary helper functions, not control flow, lambdas or initializers.
        if (end >= 0 && !prefix.some(t => ['if', 'for', 'while', 'switch', 'catch', '=', '['].includes(t.text)) && prefix[0]?.text !== 'do') {
          functions.push([scan[start].from, scan[end].to]); i = end; continue;
        }
      }
      depth++;
    } else if (token.text === '}') depth = Math.max(0, depth - 1);
  }
  return { main: false, preprocessor, functions };
}
function declarationRanges(source, structure) {
  const masked = maskedSource(source), directives = structure.preprocessor;
  const firstCode = blankRanges(masked, directives).search(/\S/);
  const ranges = [], grouped = [];
  let depth = 0, groupStart = 0, directiveStart = 0, functionCursor = 0;
  for (const [index, [start, end]] of directives.entries()) {
    const name = masked.slice(start, end).match(/^\s*#\s*(\w+)/)?.[1];
    if (['if', 'ifdef', 'ifndef'].includes(name)) { if (!depth) { groupStart = start; directiveStart = index; } depth++; }
    else if (name === 'endif' && depth) {
      if (--depth === 0) {
        grouped.push([groupStart, end]);
        const members = directives.slice(directiveStart, index + 1);
        while (functionCursor < structure.functions.length && structure.functions[functionCursor][0] < end) {
          const fn = structure.functions[functionCursor++]; if (fn[0] >= groupStart && fn[1] <= end) members.push(fn);
        }
        if (!blankRanges(masked.slice(groupStart, end), members.map(([from, to]) => [from-groupStart, to-groupStart])).trim()) ranges.push([groupStart, end]);
      }
    } else if (!depth && (name === 'include' || firstCode < 0 || start < firstCode)) ranges.push([start, end]);
  }
  if (depth) grouped.push([groupStart, source.length]);
  let groupIndex = 0;
  for (const range of structure.functions) {
    while (groupIndex < grouped.length && grouped[groupIndex][1] < range[0]) groupIndex++;
    const group = grouped[groupIndex];
    if (!group || range[0] < group[0] || range[1] > group[1]) ranges.push(range);
  }
  const merged = [];
  for (const range of ranges.sort((a, b) => a[0] - b[0])) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]); else merged.push([...range]);
  }
  return merged;
}
function prepareClangSource(source, language, settings, fileName) {
  const c = language === 'c', name = fileName || (c ? 'main.c' : 'main.cpp');
  const headers = c ? settings.cHeaders : settings.cppHeaders;
  const includes = headers.map(header => '#include <' + header + '>').join('\n');
  const line = number => '#line ' + number + ' "' + name + '"\n';
  if (!settings.autoMain) return includes + '\n' + line(1) + source;
  const structure = analyze(source);
  if (structure.main) return includes + '\n' + line(1) + source;
  const ranges = declarationRanges(source, structure);
  const declarations = ranges.map(([start, end]) => line(source.slice(0, start).split('\n').length) + source.slice(start, end) + '\n').join('');
  return includes + '\n' + declarations + (c ? 'int main(void) {\n' : 'int main() {\n') + line(1) + blankRanges(source, ranges) + '\nreturn 0;\n}\n';
}
module.exports = { prepareClangSource, analyze, maskedSource };
