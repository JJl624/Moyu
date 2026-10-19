import {relativeHref,markdownDestination} from '../shared/link-destinations.mjs';
import {isNativeImage} from './fileKinds';
export const displayableAttachment=(path:string)=>isNativeImage(path)||/\.excalidraw(?:[?#].*)?$/i.test(path);
export function attachmentSize(alt:string){
  const match=/^(.*)\|(\d+(?:\.\d+)?)(%)?$/.exec(alt),value=match?Number(match[2]):0;
  return match&&value>0&&Number.isFinite(value)?{label:match[1],width:match[3]?undefined:value,scale:match[3]?value/100:undefined}:{label:alt,width:undefined,scale:undefined};
}
export function standardAttachment(document:string,target:string,label=target.split('/').pop()||'附件',size=''){
  const name=(label+(size&&attachmentSize('x|'+size).label==='x'?'|'+size:'')).replace(/[\\[\]]/g,'\\$&');
  return (displayableAttachment(target)?'!':'')+'['+name+']('+markdownDestination(relativeHref(document,target))+')';
}
export function applyAttachmentSize(element:HTMLElement|SVGSVGElement,alt:string,intrinsic:number){
  const size=attachmentSize(alt),width=size.width??(size.scale===undefined?(element.namespaceURI==='http://www.w3.org/2000/svg'?intrinsic:undefined):intrinsic*size.scale);
  element.style.width=width!==undefined&&width>0?Math.min(10000,width)+'px':'';
  element.style.maxWidth='100%';element.style.height='auto';
  return size.label;
}
