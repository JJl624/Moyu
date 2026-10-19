import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { type EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { inlineRaw, inlineSourceRequired, inlineTypes, parseInline } from '../inlineSyntax';

type Part = { raw: string; source: boolean };
const candidates = new WeakMap<ProseNode, Part[] | null>();
function surroundingText(node: ProseNode): Part[] | null {
  if (candidates.has(node)) return candidates.get(node)!;
  const raw = node.textContent, parsed = parseInline(raw);
  let result: Part[] | null = null;
  if (parsed?.nodes.some(n => inlineTypes.has(n.type))) {
    const parts = parsed.nodes.map(n => {
      const value = inlineRaw(n, raw);
      return { raw: value, source: inlineSourceRequired(n, value) };
    });
    // Incomplete source and escaped Markdown stay editable verbatim.
    if (parts.some(p => !p.source) && parts.map(p => p.raw).join('') === raw) result = parts;
  }
  candidates.set(node, result);
  return result;
}

// Inline source owns Markdown delimiters only. Surrounding plain text belongs
// to the paragraph, so list input rules and paragraph splitting see it normally.
export function separateInlineText(state: EditorState, editing?: ProseNode) {
  const edits: { pos: number; node: ProseNode; parts: Part[] }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'resource_link') return;
    // An unfinished delimiter edit must remain one text region until the caret
    // leaves it. Parsing a draft can otherwise replace the region mid-keystroke.
    if (node === editing) return false;
    const parts = surroundingText(node);
    if (parts) edits.push({ pos, node, parts });
    return false;
  });
  if (!edits.length) return null;
  const tr = state.tr;
  let anchor = state.selection.anchor, head = state.selection.head;
  for (const { pos, node, parts } of edits.reverse()) {
    const nodes = parts.filter(p => p.raw).map(p =>
      p.source
        ? node.type.create(node.attrs, state.schema.text(p.raw))
        : state.schema.text(p.raw)
    );
    tr.replaceWith(pos, pos + node.nodeSize, nodes);
    const map = tr.mapping.maps.at(-1)!;
    const endpoint = (at: number) => {
      if (at <= pos || at >= pos + node.nodeSize) return map.map(at);
      let remaining = at - pos - 1, target = pos;
      for (const p of parts) {
        if (remaining <= p.raw.length) return target + remaining + (p.source ? 1 : 0);
        remaining -= p.raw.length;
        target += p.raw.length + (p.source ? 2 : 0);
      }
      return target;
    };
    anchor = endpoint(anchor);
    head = endpoint(head);
  }
  if (state.selection instanceof TextSelection) {
    tr.setSelection(TextSelection.create(tr.doc, anchor, head));
  }
  return tr;
}
