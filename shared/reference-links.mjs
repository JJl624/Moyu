import * as linkDestinations from './link-destinations.mjs';
const eligible=p=>p.split('/').every(s=>s&&!s.startsWith('.')&&s!=='node_modules'&&!/[<>:"\\|?*\x00-\x1f]/.test(s)&&!/[. ]$/.test(s)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s));
const normalize=value=>{const parts=[];for(const part of value.split('/')){if(!part||part==='.')continue;if(part==='..'&&parts.length&&parts.at(-1)!=='..')parts.pop();else parts.push(part);}return parts.join('/')||'.';};
const localPath=(document,url)=>{
  const raw=String(url||'').split(/[?#]/)[0];let decoded;try{decoded=decodeURIComponent(raw);}catch{decoded=raw;}
  if(!decoded||/^([a-z][\w+.-]*:|\/)/i.test(decoded))return '';
  const target=normalize([...document.split('/').slice(0,-1),decoded].join('/'));return eligible(target)?target:'';
};
const {relativeHref:link,markdownDestination,destinationSpan}=linkDestinations;
let parser;
let wiki;
const wikiModule=()=>wiki ||= import('./wiki-links.mjs');
async function links(content){
  parser ||= Promise.all([import('unified'),import('remark-parse'),import('remark-gfm')]).then(([u,p,g])=>u.unified().use(p.default).use(g.default));
  const tree=(await parser).parse(content),out=[];(await wikiModule()).wikiSyntax(tree,content);
  const definitions=new Map();function index(n){if(n.type==='definition'&&!definitions.has(n.identifier))definitions.set(n.identifier,n);n.children?.forEach(index);}index(tree);
  function visit(n){if(['link','image','definition','wikiEmbed','wikiLink'].includes(n.type)&&n.url)out.push(n);else if(['linkReference','imageReference'].includes(n.type)){const definition=definitions.get(n.identifier);if(definition)out.push({...n,url:definition.url});}n.children?.forEach(visit);}visit(tree);return out;
}
async function referencePath(document,node,files=[]){return ['wikiEmbed','wikiLink'].includes(node.type)?(await wikiModule()).wikiPath(document,node.url,files):localPath(document,node.url);}
// Locate only the destination, leaving labels, titles, whitespace and fenced
// code untouched. Parentheses and escaped delimiters are valid Markdown URLs.
function destination(content,node){
  if(['linkReference','imageReference'].includes(node.type))return null;
  const start=node.position.start.offset,end=node.position.end.offset,raw=content.slice(start,end);
  if(['wikiEmbed','wikiLink'].includes(node.type)){const from=raw.indexOf(node.url,raw.startsWith('!')?3:2);return from<0?null:{from:start+from,to:start+from+node.url.length};}
  const span=destinationSpan(raw,node.type==='definition');return span?{from:start+span.from,to:start+span.to,angle:span.angle}:null;
}
async function rewrite(content,document,from,to,files=[]){
  const moves=Array.isArray(from)?from:[{from,to}],remap=p=>{const m=moves.find(m=>p===m.from||p.startsWith(m.from+'/'));return m?m.to+p.slice(m.from.length):p;},nextDocument=remap(document),edits=[];
  for(const node of await links(content)){
    const target=await referencePath(document,node,files);if(!target)continue;
    const isWiki=['wikiEmbed','wikiLink'].includes(node.type),next=remap(target);if(next===target&&(isWiki||nextDocument===document))continue;
    const range=destination(content,node);if(range){const href=(isWiki?next:link(nextDocument,next))+(node.url.match(/[?#].*$/)?.[0]||'');edits.push({...range,value:isWiki?href:markdownDestination(href,range.angle)});}
  }
  for(const e of edits.sort((a,b)=>b.from-a.from))content=content.slice(0,e.from)+e.value+content.slice(e.to);
  return content;
}
export {localPath,link,links,rewrite,referencePath};
