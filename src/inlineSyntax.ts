import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import remarkHighlight from '../shared/remark-highlight.mjs';
import remarkUnderline from '../shared/remark-underline.mjs';
import { readableSource } from '../shared/link-destinations.mjs';
import { wikiPath, wikiSyntax } from '../shared/wiki-links.mjs';
import { displayableAttachment, standardAttachment } from './attachmentLayout';
import { attachmentFromSource } from './attachmentLinks';
export type InlineAst = {
  type: string;
  value?: string;
  url?: string;
  parameter?: string;
  alt?: string | null;
  title?: string | null;
  identifier?: string;
  children?: InlineAst[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkHighlight).use(remarkUnderline);
export const inlineFormatTree = (raw: string) => parser.parse(raw) as InlineAst;
export const readableMarkdown = (markdown: string) =>
  readableSource(parser.parse(markdown), markdown).value;
// Old double-bracket content is converted only when opening a note. It is no
// longer an editing or rendering syntax, and code/math examples stay literal.
export function canonicalMarkdown(
  markdown: string,
  document: string,
  files: Array<string | { path: string }> = [],
) {
  const edits: { from: number; to: number; value: string }[] = [],
    tree = wikiSyntax(parser.parse(markdown), markdown);
  const walk = (node: InlineAst) => {
    if (['wikiEmbed', 'wikiLink'].includes(node.type) && node.url && node.position) {
      const target = wikiPath(document, node.url, files),
        size = node.type === 'wikiEmbed' && /^\d+(?:x\d+)?$/.test(node.parameter || '')
          ? (node.parameter || '').split('x')[0]
          : '',
        label = node.type === 'wikiLink'
          ? node.parameter || target.split('/').pop() || '附件'
          : target.split('/').pop() || '附件';
      let value = standardAttachment(document, target, label, size);
      if (node.type === 'wikiLink' && displayableAttachment(target)) value = value.slice(1);
      edits.push({ from: node.position.start.offset!, to: node.position.end.offset!, value });
      return;
    }
    node.children?.forEach(walk);
  };
  walk(tree as InlineAst);
  for (const edit of edits.sort((a, b) => b.from - a.from)) {
    markdown = markdown.slice(0, edit.from) + edit.value + markdown.slice(edit.to);
  }
  return readableMarkdown(markdown);
}
export const inlineTypes = new Set([
  'strong',
  'highlight',
  'underline',
  'emphasis',
  'delete',
  'inlineCode',
  'inlineMath',
  'link',
  'image',
  'break',
  'html',
]);
export function inlineRaw(node: InlineAst, markdown: string): string {
  if (node.type === 'link' || node.type === 'image') return attachmentFromSource(node, markdown);
  const from = node.position?.start.offset, to = node.position?.end.offset;
  return from === undefined || to === undefined
    ? node.value || ''
    : readableSource(node, markdown).value;
}
// A link may be temporarily incomplete while its filename or delimiters are
// being edited. Reopening that text must keep it as source: turning it into a
// normal text node makes remark escape the brackets on the next list/save edit.
function unfinishedLink(raw: string) {
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\') {
      i++;
      continue;
    }
    if (
      raw[i] === '!' && raw[i + 1] === '[' || raw[i] === '[' && /^\[[^\]\n]*\]\(/.test(raw.slice(i))
    ) return true;
  }
  return false;
}
function commentStart(raw: string) {
  for (let index=raw.indexOf('<!--'); index>=0; index=raw.indexOf('<!--',index+4)) {
    let escapes=0;for(let at=index-1;at>=0&&raw[at]==='\\';at--) escapes++;
    if(escapes%2===0) return index;
  }
  return -1;
}
export function sourceInlineTree(tree: InlineAst, markdown: string) {
  const walk = (node: InlineAst) => {
    if (!node.children) return;
    node.children = node.children.map(child => {
      // The commonmark preset wraps flow HTML into a paragraph before this
      // transform runs. Restore standalone comments to an editable text block.
      const html = child.type==='paragraph' && child.children?.length===1 && child.children[0].type==='html' ? child.children[0] : null;
      if(html && /^<!--/.test(html.value || '')) return {type:'commentBlock',value:html.value,position:child.position};
      const raw = inlineRaw(child, markdown);
      if (child.type === 'html' && /^<!--/.test(raw) && !['paragraph','heading','tableCell'].includes(node.type)) {
        return {type:'commentBlock', value:child.value || raw, position:child.position};
      }
      if (inlineSourceRequired(child, raw)) {
        return { type: 'inlineSource', value: raw, position: child.position };
      }
      walk(child);
      return child;
    });
  };
  walk(tree);
}
// Escaped indentation is still ordinary whitespace, so reopening a paragraph
// preserves its inline boundaries and caret positions.
export function inlineSourceRequired(node: InlineAst, raw: string) {
  // Milkdown synthesizes positionless breaks for soft newlines. They belong to
  // its hardbreak schema; replacing them with empty source nodes loses lines.
  return (inlineTypes.has(node.type) && (node.type !== 'html' || /^<!--/.test(raw))
    && (node.type !== 'break' || !!raw))
    || node.type === 'text' && !!node.position
      && (raw !== node.value && /\S/.test(node.value || '') || unfinishedLink(raw) || commentStart(raw)>=0);
}
export function parseInline(raw: string) {
  // This is an inline editing region, not a Markdown document. A leading list
  // marker (or heading/quote marker) typed beside a link must not hide its preview.
  const prefix = 'a ',
    tree = parser.parse(prefix + raw) as InlineAst,
    paragraph = tree.children?.[0];
  if (tree.children?.length !== 1 || paragraph?.type !== 'paragraph') return null;
  let nodes = paragraph.children || [];
  if (nodes[0]?.type === 'text') {
    nodes[0].value = (nodes[0].value || '').slice(prefix.length);
    if (!nodes[0].value) nodes.shift();
  }
  const offsets = (node: InlineAst) => {
    if (node.position) {
      node.position.start.offset = Math.max(0, node.position.start.offset! - prefix.length);
      node.position.end.offset = Math.max(0, node.position.end.offset! - prefix.length);
    }
    node.children?.forEach(offsets);
  };
  nodes.forEach(offsets);
  // remark treats unfinished inline comments as ordinary text. Keep a draft
  // source region editable instead of escaping '<' during the next save.
  nodes=nodes.flatMap(node=>{
    if(node.type!=='text'||!node.position) return [node];
    const from=node.position.start.offset!,to=node.position.end.offset!,source=raw.slice(from,to),index=commentStart(source);
    if(index<0) return [node];
    return [
      ...(index ? [{type:'text',value:source.slice(0,index),position:{start:{offset:from},end:{offset:from+index}}}] : []),
      {type:'html',value:source.slice(index),position:{start:{offset:from+index},end:{offset:to}}},
    ];
  });
  const decorated = (node: InlineAst): boolean =>
    inlineTypes.has(node.type) || node.type === 'text' && inlineRaw(node, raw) !== node.value
    || !!node.children?.some(decorated);
  return {
    nodes,
    decorated: nodes.some(decorated),
    kind: nodes.length === 1 ? nodes[0].type : 'mixed',
  };
}
export function lastInline(raw: string) {
  const parsed = parseInline(raw), node = parsed?.nodes.at(-1);
  return node && inlineTypes.has(node.type) && node.position?.end.offset === raw.length
    ? node
    : null;
}
export function inlineLinkAt(
  raw: string,
  offset: number,
):
  | { href: string; label: string; image: boolean; raw: string; from: number; to: number; wiki?: boolean; parameter?: string }
  | null
{
  let result: ReturnType<typeof inlineLinkAt> = null;
  const tree = parser.parse(raw) as InlineAst;
  const definitions = new Map<string, string>();
  const collect = (node: InlineAst) => {
    if (node.type === 'definition' && node.identifier && node.url && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
    node.children?.forEach(collect);
  };
  collect(tree);
  const text = (node: InlineAst): string =>
    ['wikiEmbed', 'wikiLink'].includes(node.type)
      ? node.parameter || node.url || ''
      : node.value ?? node.alt ?? node.children?.map(text).join('') ?? '';
  const walk = (node: InlineAst) => {
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (
      ['link', 'image', 'imageReference', 'linkReference', 'wikiEmbed', 'wikiLink'].includes(node.type) && start !== undefined
      && end !== undefined && offset >= start && offset <= end
    ) {
      result = {
        href: node.url || definitions.get(node.identifier || '') || '',
        label: ['image', 'imageReference'].includes(node.type) ? node.alt || '' : text(node),
        image: ['image', 'imageReference'].includes(node.type),
        raw: raw.slice(start, end),
        from: start,
        to: end,
        ...(['wikiEmbed', 'wikiLink'].includes(node.type)
          ? { wiki: true, parameter: node.parameter }
          : {}),
      };
      return;
    }
    node.children?.forEach(walk);
  };
  walk(tree);
  return result;
}
