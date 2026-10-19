import { folderOf } from './types';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
export {readableHref,relativeHref} from '../shared/link-destinations.mjs';
export function containsDrawingLink(markdown:string):boolean {
  let found=false;const walk=(node:{type:string;url?:string;children?:unknown[]})=>{if(['link','image'].includes(node.type)&&node.url&&!/^([a-z][\w+.-]*:|\/)/i.test(node.url)&&/\.excalidraw(?:[?#].*)?$/i.test(node.url))found=true;node.children?.forEach(n=>walk(n as Parameters<typeof walk>[0]));};
  walk(unified().use(remarkParse).parse(markdown));return found;
}

export function relativeLink(document: string, target: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(target.split('#')[0]);
  } catch {
    return '';
  }
  if (/^[a-z]+:/i.test(decoded)) return '';
  const resolved: string[] = [];
  (folderOf(document) + '/' + decoded).split('/').forEach((part) => {
    if (part === '..') resolved.pop();
    else if (part && part !== '.') resolved.push(part);
  });
  return resolved.join('/');
}
