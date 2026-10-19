import type { EditorState } from '@milkdown/kit/prose/state';
import { TextSelection } from '@milkdown/kit/prose/state';
import { lastInline } from '../inlineSyntax';

type Segment = { start: number; end: number; pos: number; source: boolean };

// Source containers add two model positions which are absent from Markdown.
// ProseMirror input rules subtract string lengths from model positions and
// therefore cannot safely match across these containers. Map each boundary
// explicitly, and keep the real input and conversion in one transaction.
export function inlineInputTransaction(state: EditorState, from: number, to: number, text: string) {
  if (text && !/[*_~`$)=\]>-]$/.test(text)) return null;
  const start=state.doc.resolve(from),end=state.doc.resolve(to);
  if (!start.sameParent(end) || !start.parent.inlineContent || start.parent.type.spec.code) return null;
  const tr=state.tr;
  if (text) tr.insertText(text,from,to);
  const caret=from+text.length,head=tr.doc.resolve(caret),segments:Segment[]=[];
  let raw='';
  head.parent.forEach((node,offset)=>{
    if (offset>=head.parentOffset) return;
    if (!node.isText && node.type.name!=='resource_link') {raw='';segments.length=0;return;}
    const length=Math.min(node.nodeSize,head.parentOffset-offset);
    const value=node.isText?node.text!.slice(0,length):node.textContent;
    const begin=raw.length;
    raw+=value;
    segments.push({start:begin,end:raw.length,pos:head.start()+offset,source:!node.isText});
  });
  const last=lastInline(raw);
  if (!last) return null;
  const offset=last.position!.start.offset!,value=raw.slice(offset);
  const first=segments.find(segment=>offset<segment.end);
  if (!first) return null;
  // An already-open source region owns its whole editable draft. Do not
  // replace only its child text with another nested source container.
  if (first.source && offset!==first.start) return null;
  const left=first.pos+(offset-first.start),right=caret;
  const existing=tr.doc.nodeAt(left);
  if (existing?.type.name==='resource_link' && existing.nodeSize===right-left && existing.textContent===value) return null;
  tr.replaceWith(left,right,state.schema.nodes.resource_link.create(null,state.schema.text(value)));
  return tr.setSelection(TextSelection.create(tr.doc,left+1+value.length));
}
