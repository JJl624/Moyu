import { Fragment, Slice, type Node, type Schema } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { inlineRaw, inlineSourceRequired, parseInline } from '../inlineSyntax';
import { markdownDestination } from '../../shared/link-destinations.mjs';
import {parserCtx} from '@milkdown/kit/core';
import {readNativeSelection} from './nativeSelection';

function markedSource(node: Node) {
  let raw = node.text || '';
  if (!node.marks.length) return raw;
  const code = node.marks.find(mark => mark.type.name === 'inlineCode');
  if (code) {
    const fence = '`'.repeat(Math.max(0, ...[...raw.matchAll(/`+/g)].map(m => m[0].length)) + 1);
    const pad = raw.startsWith('`') || raw.endsWith('`') || /^ .* $/.test(raw) && /\S/.test(raw) ? ' ' : '';
    raw = fence + pad + raw + pad + fence;
  } else raw = raw.replace(/[\\`*_~$=\[\]]/g, '\\$&');
  for (const mark of [...node.marks].reverse()) {
    if (mark.type.name === 'strong') raw = '**' + raw + '**';
    else if (mark.type.name === 'emphasis') raw = '*' + raw + '*';
    else if (mark.type.name === 'strike_through') raw = '~~' + raw + '~~';
    else if (mark.type.name === 'link') raw = '[' + raw + '](' + markdownDestination(mark.attrs.href || '')
      + (mark.attrs.title ? ' "' + String(mark.attrs.title).replace(/["\\]/g, '\\$&') + '"' : '') + ')';
  }
  return raw;
}
export function normalizeInlinePaste(slice: Slice, schema: Schema) {
  const inline = (content: Fragment): Fragment => {
    const result: Node[] = [];
    let raw = '';
    const flush = () => {
      if (!raw) return;
      const parsed = parseInline(raw);
      if (!parsed?.decorated) result.push(schema.text(raw));
      else for (const ast of parsed.nodes) {
        const source = inlineRaw(ast, raw);
        if (!source) continue;
        result.push(inlineSourceRequired(ast, source)
          ? schema.nodes.resource_link.create(null, schema.text(source))
          : schema.text(ast.value || source));
      }
      raw = '';
    };
    content.forEach(child => {
      if (child.isText) raw += markedSource(child);
      else { flush(); result.push(child); }
    });
    flush();
    return Fragment.fromArray(result);
  };
  const walk = (node: Node): Node => {
    if (node.type.spec.code || node.type.name === 'resource_link') return node;
    if (!node.inlineContent) {
      return node.content.size ? node.copy(Fragment.fromArray([...children(node)].map(walk))) : node;
    }
    return node.copy(inline(node.content));
  };
  const content = [...children(slice)];
  const normalized=content.every(node => node.isInline)
    ? inline(slice.content)
    : Fragment.fromArray(content.map(walk));
  // DOMParser opens every non-leaf at a paste boundary, including our inline
  // source containers. Opening those strips their delimiters into plain text.
  return new Slice(normalized,Math.min(slice.openStart,blockDepth(normalized.firstChild)),Math.min(slice.openEnd,blockDepth(normalized.lastChild,true)));
}
function blockDepth(node:Node|null,last=false){let count=0;while(node&&!node.isInline&&!node.isLeaf){count++;node=last?node.lastChild:node.firstChild;}return count;}
function* children(node: Node | Slice) {
  const values: Node[] = [];
  node.content.forEach(child => values.push(child));
  yield* values;
}
export function markdownLinkSlice(doc:Node):Slice|null{
  let links=false;
  doc.descendants(node=>{
    if(node.type.name==='resource_link'){if(parseInline(node.textContent)?.nodes.some(n=>['link','image','linkReference','imageReference'].includes(n.type)))links=true;return false;}
    return !node.type.spec.code;
  });
  if(!links)return null;
  return markdownPasteSlice(doc);
}
export function markdownPasteSlice(doc:Node):Slice{
  if(doc.childCount===1&&doc.firstChild?.type.name==='paragraph')return new Slice(doc.firstChild.content,0,0);
  return new Slice(doc.content,blockDepth(doc.firstChild),blockDepth(doc.lastChild,true));
}
export const inlinePaste = $prose(ctx => new Plugin({
  props: {
    transformPasted: (slice, view) => normalizeInlinePaste(slice, view.state.schema),
    handleDOMEvents:{paste(view,event){
      const data=event.clipboardData,text=data?.getData('text/plain');
      if(!view.editable||!text||text.length>20*1024*1024||data?.files.length||/<img\b[^>]*src=["']data:/i.test(data?.getData('text/html')||''))return false;
      if(data?.getData('vscode-editor-data'))return false;
      const plain=!data?.getData('text/html');
      if(!plain&&(!text.includes('[')||!text.includes(']')||!text.includes('(')&&!text.includes('][')))return false;
      readNativeSelection(view);
      if(view.state.selection.$from.parent.type.spec.code)return false;
      const doc=ctx.get(parserCtx)(text);if(!doc)return false;
      // Keep the parsed document directly. Serializing soft newlines to DOM
      // and parsing it again collapses them as HTML whitespace.
      const slice=plain?markdownPasteSlice(doc):markdownLinkSlice(doc);if(!slice)return false;
      const tr=view.state.tr.replaceSelection(normalizeInlinePaste(slice,view.state.schema)).scrollIntoView();
      view.dispatch(tr);event.preventDefault();return true;
    }},
  },
}));
