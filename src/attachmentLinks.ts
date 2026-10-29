import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {readableHref} from './markdownLinks';
import {markdownDestination,readableSource} from '../shared/link-destinations.mjs';

type LinkNode={type:string;url?:string;alt?:string|null;title?:string|null;value?:string;attachmentRaw?:string;children?:LinkNode[];position?:{start:{offset?:number};end:{offset?:number}}};
const parser=unified().use(remarkParse);
// Notes and web links keep the normal link editor. Every image and every local
// file link uses the same attachment editor, regardless of its file extension.
export const isAttachmentLink=(node:LinkNode)=>node.type==='image'||node.type==='link'&&!!node.url&&!/^([a-z][\w+.-]*:|\/|#)/i.test(node.url)&&! /\.(md|markdown)(?:[?#].*)?$/i.test(node.url);
const labelText=(node:LinkNode):string=>node.value??node.children?.map(labelText).join('')??'';
export const attachmentLabel=(node:LinkNode):string=>node.type==='image'?node.alt||'':labelText(node);
export function attachmentMarkdown(node:LinkNode):string {
  if(node.attachmentRaw!==undefined)return node.attachmentRaw;
  const label=(node.type==='image'?node.alt||'':labelText(node)).replace(/[\\\[\]]/g,'\\$&');
  const href=readableHref(node.url||'');
  const destination=markdownDestination(href);
  return (node.type==='image'?'!':'')+'['+label+']('+destination+(node.title?' "'+node.title.replace(/[\\"]/g,'\\$&')+'"':'')+')';
}
export function attachmentFromSource(node:LinkNode,markdown:string):string {
  const start=node.position?.start.offset,end=node.position?.end.offset;
  if(start===undefined||end===undefined)return attachmentMarkdown(node);
  return readableSource(node,markdown).value;
}
export function rememberAttachmentSources(tree:LinkNode,markdown:string){
  const walk=(node:LinkNode)=>{if(isAttachmentLink(node))node.attachmentRaw=attachmentFromSource(node,markdown);node.children?.forEach(walk);};walk(tree);
}
export function parseAttachment(raw:string) {
  const tree=parser.parse(raw) as LinkNode,paragraph=tree.children?.[0],node=paragraph?.children?.[0];
  if(tree.children?.length!==1||paragraph?.type!=='paragraph'||paragraph.children?.length!==1||!node||!isAttachmentLink(node)||node.position?.start.offset!==0||node.position?.end.offset!==raw.length)return null;
  return {href:readableHref(node.url||''),label:node.type==='image'?node.alt||'':labelText(node),image:node.type==='image',raw};
}
export function attachmentAt(markdown:string,offset:number) {
  let found:ReturnType<typeof parseAttachment>=null;
  const walk=(node:LinkNode)=>{const start=node.position?.start.offset,end=node.position?.end.offset;if(isAttachmentLink(node)&&start!==undefined&&end!==undefined&&offset>=start&&offset<=end){found=parseAttachment(markdown.slice(start,end));return;}node.children?.forEach(walk);};
  walk(parser.parse(markdown) as LinkNode);return found;
}
