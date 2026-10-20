import { defaultHandlers } from 'mdast-util-to-markdown';

// Keep ordinary blockquotes and their Markdown serialization intact. A fold
// only adds metadata and separates the heading's first line from its body.
function splitLine(children, source) {
  const head = [], tail = [];
  let split = false;
  for (const node of children) {
    if (split) { tail.push(node); continue; }
    if (typeof node.value === 'string' && node.value.includes('\n')) {
      const at = node.value.indexOf('\n'), before = node.value.slice(0, at).replace(/\r$/, ''), after = node.value.slice(at + 1);
      const newline = source.indexOf('\n', node.position?.start.offset || 0), lineStart = newline + 1;
      const prefix = source.slice(lineStart).match(/^(?:[ \t]*>[ \t]?)+[ \t]*/)?.[0] || '';
      const end = node.position && { offset: source[newline - 1] === '\r' ? newline - 1 : newline, line: node.position.start.line, column: node.position.start.column + newline - node.position.start.offset };
      const start = node.position && { offset: lineStart + prefix.length, line: node.position.start.line + 1, column: prefix.length + 1 };
      if (before) head.push({ ...node, value: before, position: node.position && { start: node.position.start, end } });
      if (after) tail.push({ ...node, value: after, position: node.position && { start, end: node.position.end } });
      split = true;
    } else if (node.children) {
      const parts = splitLine(node.children, source);
      if (parts.head.length) head.push({ ...node, children: parts.head, position: node.position && { start: node.position.start, end: parts.split ? parts.head.at(-1).position?.end || node.position.end : node.position.end } });
      if (parts.tail.length) tail.push({ ...node, children: parts.tail, position: node.position && { start: parts.tail[0].position?.start || node.position.start, end: node.position.end } });
      split = parts.split;
    } else if (node.type === 'break') {
      split = true;
    } else head.push(node);
  }
  return { head, tail, split };
}

export default function remarkFoldingQuotes() {
  const data = this.data();
  (data.toMarkdownExtensions ||= []).push({ handlers: { blockquote(node, parent, state, info) {
    const value = defaultHandlers.blockquote(node, parent, state, info);
    return typeof node.folding === 'boolean' ? value.replace(/^(> )\\(\[[+-]\])/, '$1$2') : value;
  } } });
  return (tree, file) => {
    const source = String(file.value);
    function walk(node) {
      const first = node.children?.[0];
      if (node.type === 'blockquote' && first?.type === 'paragraph') {
        const raw = source.slice(first.position?.start.offset, first.position?.end.offset);
        const marker = /^\[([+-])\]/.exec(raw);
        // Only the first characters count; escaped markers stay ordinary text.
        if (marker?.index === 0 && first.children[0]?.type === 'text' && /^\[[+-]\]/.test(first.children[0].value)) {
          node.folding = marker[1] === '+';
          const parts = splitLine(first.children, source);
          if (parts.split) {
            const title = { ...first, children: parts.head, position: { start: first.position.start, end: parts.head.at(-1)?.position?.end || first.position.end } };
            const body = { ...first, children: parts.tail, position: { start: parts.tail[0]?.position?.start || first.position.start, end: first.position.end } };
            node.children.splice(0, 1, title, ...(parts.tail.length ? [body] : []));
          }
        }
      }
      node.children?.forEach(walk);
    }
    walk(tree);
  };
}

export function foldingQuoteHTML(state, node) {
  if (typeof node.folding !== 'boolean') return state.applyData(node, { type: 'element', tagName: 'blockquote', properties: {}, children: state.all(node) });
  const first = node.children[0], title = { ...first, children: first.children.map(child => ({ ...child })) };
  title.children[0].value = title.children[0].value.replace(/^\[[+-]\][ \t]*/, '');
  const result = { type: 'element', tagName: 'details', properties: { className: ['folding-quote'], ...(node.folding ? { open: true } : {}) }, children: [
    { type: 'element', tagName: 'summary', properties: {}, children: state.all(title) },
    ...state.all({ ...node, children: node.children.slice(1) }),
  ] };
  state.patch(node, result);
  return result;
}
