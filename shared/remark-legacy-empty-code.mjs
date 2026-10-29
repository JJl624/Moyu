import {isEmptyParagraphMarker} from './empty-paragraph.mjs';

function plainParagraph(node) {
  if (node?.type !== 'paragraph' || !node.children?.every(child => ['text', 'break'].includes(child.type))) return null;
  return node.children.map(child => child.type === 'break' ? '\n' : child.value).join('');
}

// Compatibility is limited to an empty fence with an app ID, preceded by
// our empty-paragraph marker and optionally followed by another marker.
function emptyFence(value) {
  const rows = String(value).trimEnd().split(/\r?\n/);
  if (![3, 4].includes(rows.length) || !isEmptyParagraphMarker(rows[0])
    || rows.length === 4 && !isEmptyParagraphMarker(rows[3])) return null;
  const header = rows[1].match(/^\s*(`{3,}|~{3,})([\w+#.-]+)[ \t]+(.*)$/);
  if (!header || rows[2].trim() !== header[1] || !/(?:^|\s)\{id=\d{4}\}(?:\s|$)/.test(header[3])) return null;
  return {rows, fence: header[1], language: header[2], meta: header[3]};
}

function sourceLocations(file) {
  let lines, offsets;
  return (node, row, text) => {
    if (!lines) {
      const source = String(file?.value || '');
      lines = source.split(/\r?\n/);
      offsets = [0];
      for (const newline of source.matchAll(/\r?\n/g)) offsets.push(newline.index + newline[0].length);
    }
    const line = (node.position?.start.line || 0) + row, column = lines[line - 1]?.indexOf(text);
    if (column === undefined || column < 0 || offsets[line - 1] === undefined) return undefined;
    const start = {line, column: column + 1, offset: offsets[line - 1] + column};
    return {start, end: {...start, column: start.column + text.length, offset: start.offset + text.length}};
  };
}

export default function remarkLegacyEmptyCode() {
  return (tree, file) => {
    const locate = sourceLocations(file);
    const recover = (node, allowEscaped) => {
      const html = node.type === 'html' ? node
        : node.type === 'paragraph' && node.children?.length === 1 && node.children[0].type === 'html' ? node.children[0] : null;
      const value = html?.value ?? (allowEscaped ? plainParagraph(node) : null);
      if (value === null || value === undefined) return null;
      const parsed = emptyFence(value);
      if (!parsed) return null;
      const original = html || node, {rows, fence, language: lang, meta} = parsed;
      const gap = row => ({type: 'paragraph', children: [], position: locate(original, row, rows[row].trim())});
      const start = locate(original, 1, fence), end = locate(original, 2, fence);
      const code = {type: 'code', lang, meta, value: '', position: start && end ? {start: start.start, end: end.end} : original.position};
      return [gap(0), code, ...(rows.length === 4 ? [gap(3)] : [])];
    };
    const walk = node => {
      if (['root', 'listItem', 'blockquote'].includes(node.type)) {
        const result = [], children = node.children || [];
        for (let index = 0; index < children.length; index++) {
          const first = children[index], middle = children[index + 1], last = children[index + 2];
          const marker = plainParagraph(first), body = plainParagraph(middle), tail = plainParagraph(last);
          if (node.type === 'listItem' && isEmptyParagraphMarker(marker) && body !== null) {
            const trailing = isEmptyParagraphMarker(tail);
            const fixed = recover({type: 'html', value: marker + '\n' + body + (trailing ? '\n' + tail : ''), position: first.position}, false);
            if (fixed) {
              fixed[0].position = first.position;
              fixed[1].position = middle.position;
              if (trailing) fixed[2].position = last.position;
              result.push(...fixed);
              index += trailing ? 2 : 1;
              continue;
            }
          }
          result.push(...(recover(first, node.type === 'listItem') || [first]));
        }
        node.children = result;
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}
