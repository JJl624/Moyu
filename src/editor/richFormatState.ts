import { Fragment, Slice, type Node } from '@milkdown/kit/prose/model';
import { TextSelection, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { analyzeInlineFormats, applyInlineChanges } from './inlineFormatState';
import { normalizeInlinePaste } from './inlinePaste';

const cache = new WeakMap<Node, ReturnType<typeof analyzeInlineFormats>>();
function analysis(node: Node) {
  let value = cache.get(node);
  if (!value) { value = analyzeInlineFormats(node.textContent); cache.set(node,value); }
  return value;
}
export function richFormatState(state: EditorState, kind: string) {
  const selected: { node: Node; pos: number; from: number; to: number }[] = [];
  const { from, to, $from, empty } = state.selection;
  let plain = false;
  if (empty && $from.parent.type.name === 'resource_link') {
    selected.push({ node:$from.parent, pos:$from.before(), from:$from.parentOffset, to:$from.parentOffset });
  } else state.doc.nodesBetween(from,to,(node,pos,parent) => {
    if (node.type.name === 'resource_link') {
      selected.push({ node, pos, from:Math.max(0,from-pos-1), to:Math.min(node.content.size,to-pos-1) });
      return false;
    }
    if (node.type.spec.code) { plain = true; return false; }
    if (node.isText) {
      const prefix=parent?.type.name==='heading'&&parent.firstChild===node ? node.text!.match(/^#{1,6}[ \t]+/)?.[0].length||0 : 0;
      if(/\S/.test(node.text!.slice(Math.max(prefix,from-pos,0),Math.min(node.nodeSize,to-pos))))plain=true;
    }
    return true;
  });
  const active = !plain && !!selected.length && selected.every(part => analysis(part.node).active(kind,part.from,part.to));
  return {
    active,
    remove(): Transaction | null {
      if (!active) return null;
      const tr=state.tr;
      for (const part of [...selected].reverse()) {
        const raw=applyInlineChanges(part.node.textContent,analysis(part.node).changes(kind,part.from,part.to));
        const fragment=raw ? normalizeInlinePaste(new Slice(Fragment.from(state.schema.text(raw)),0,0),state.schema).content : Fragment.empty;
        tr.replaceWith(part.pos,part.pos+part.node.nodeSize,fragment);
      }
      const last=selected.at(-1)!;
      return tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(last.pos+last.node.nodeSize)))).scrollIntoView();
    },
  };
}
