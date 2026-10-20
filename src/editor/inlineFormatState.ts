import { inlineFormatTree, parseInline, type InlineAst } from '../inlineSyntax';

export const inlineKinds: Record<string, string> = {
  bold: 'strong', italic: 'emphasis', strike: 'delete', code: 'inlineCode',
  highlight: 'highlight', underline: 'underline', math: 'inlineMath', link: 'link',
};
export type InlineChange = { from: number; to: number; insert: string };
const formatKinds=new Set(Object.values(inlineKinds));
const emptyMarkers:Record<string,string>={strong:'**',emphasis:'*',delete:'~~',inlineCode:'`',highlight:'==',underline:'__',inlineMath:'$'};
type Region = { kind: string; from: number; to: number; literal: boolean; changes: InlineChange[] };
type Content = { from: number; to: number; kinds: string[] };

// Read the same syntax tree used by the preview, including custom delimiters.
// The caller caches this analysis against its immutable editor document/node.
export function analyzeInlineFormats(raw: string, document = false) {
  const regions: Region[] = [], content: Content[] = [];
  const walk = (node: InlineAst, ancestors: string[]) => {
    const from = node.position?.start.offset, to = node.position?.end.offset;
    const kind = formatKinds.has(node.type) ? node.type : undefined;
    const kinds = kind ? [...ancestors, kind] : ancestors;
    if (from !== undefined && to !== undefined && kind) {
      const first = node.children?.[0]?.position?.start.offset;
      const last = node.children?.at(-1)?.position?.end.offset;
      let changes: InlineChange[];
      if (kind==='link') {
        changes=[{from,to,insert:first!==undefined&&last!==undefined?raw.slice(first,last):node.value||''}];
      } else if (first !== undefined && last !== undefined) {
        changes = [{ from, to: first, insert: '' }, { from: last, to, insert: '' }];
      } else changes = [{ from, to, insert: node.value || '' }];
      regions.push({ kind, from, to, literal:node.type==='inlineCode'||node.type==='inlineMath', changes });
    }
    if (node.children) node.children.forEach(child => walk(child, kinds));
    else if (from !== undefined && to !== undefined && /\S/.test(node.value || node.alt || '')) {
      content.push({ from, to, kinds });
    }
  };
  const nodes = document ? inlineFormatTree(raw).children : parseInline(raw)?.nodes;
  nodes?.forEach(node => walk(node, []));
  const emptyFormat=(kind:string,from:number,to:number):InlineChange|undefined=>{
    const marker=emptyMarkers[kind];
    if(!marker||from!==to||regions.some(region=>region.literal&&region.kind!==kind&&from>region.from&&from<region.to))return;
    const start=from-marker.length,end=to+marker.length;
    if(start>=0&&raw.slice(start,end)===marker+marker&&raw[start-1]!==marker[0]&&raw[end]!==marker[0])return{from:start,to:end,insert:''};
  };
  const active = (kind: string, from = 0, to = raw.length) => {
    if (from === to) return regions.some(region => region.kind === kind && from >= region.from && to <= region.to)||!!emptyFormat(kind,from,to);
    const selected = content.filter(part => part.to > from && part.from < to && /\S/.test(raw.slice(Math.max(from,part.from),Math.min(to,part.to))));
    return selected.length ? selected.every(part => part.kinds.includes(kind))
      : regions.some(region=>region.kind===kind&&from>=region.from&&to<=region.to);
  };
  const changes = (kind: string, from = 0, to = raw.length, escapeLiteral = true): InlineChange[] => {
    const empty=emptyFormat(kind,from,to);
    if(empty)return[empty];
    const selected = regions.filter(region => region.kind === kind &&
      (from === to ? from >= region.from && to <= region.to : region.to > from && region.from < to));
    // Atomic code/math replacements can contain other syntax literally. Their
    // AST has no children, so no overlapping delimiter edits are generated.
    return selected.flatMap(region => region.changes.map(change=>region.literal&&escapeLiteral
      ? {...change,insert:literalMarkdown(change.insert)}
      : region.kind==='link'&&escapeLiteral?{...change,insert:withoutAutolinks(change.insert)}:change));
  };
  return { active, changes };
}
function literalMarkdown(value:string) {
  if(!parseInline(value)?.decorated)return value;
  return withoutAutolinks(value.replace(/[\\`*_~$=\[\]<>&]/g,'\\$&'));
}
// A URL label must stay ordinary text after removing its link, rather than
// immediately becoming another GFM autolink. Preserve other label formatting.
function withoutAutolinks(raw:string) {
  const edits:InlineChange[]=[];
  const walk=(node:InlineAst)=>{
    const from=node.position?.start.offset,to=node.position?.end.offset;
    if(node.type==='link'&&from!==undefined&&to!==undefined&&!raw.slice(from,to).startsWith('[')){
      const value=node.children?.map(child=>child.value||'').join('')||raw.slice(from,to);
      edits.push({from,to,insert:value.replace(/[:.@]/g,'\\$&')});return;
    }
    node.children?.forEach(walk);
  };
  parseInline(raw)?.nodes.forEach(walk);
  return applyInlineChanges(raw,edits);
}
export function applyInlineChanges(raw: string, changes: InlineChange[]) {
  for (const change of [...changes].sort((a,b) => b.from-a.from || b.to-a.to)) {
    raw = raw.slice(0,change.from) + change.insert + raw.slice(change.to);
  }
  return raw;
}
export function withoutInlineFormat(raw: string, kind: string) {
  return applyInlineChanges(raw, analyzeInlineFormats(raw).changes(kind,0,raw.length,false));
}
