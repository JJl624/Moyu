import {unified} from 'unified';
import remarkParse from 'remark-parse';
import type {Blockquote,RootContent} from 'mdast';
const parser=unified().use(remarkParse);

// Use the Markdown tree so escaped markers, code fences and nested quotes are
// handled exactly as quotes, rather than by searching preceding lines.
export function sourceFoldAt(source:string,offset:number):{marker:number;open:boolean}|null {
  let result:{marker:number;open:boolean}|null=null;
  const visit=(node:RootContent)=>{
    if((node.position?.start.offset??0)>offset||(node.position?.end.offset??0)<offset)return;
    if(node.type==='blockquote'){
      const first=(node as Blockquote).children[0],start=first?.position?.start.offset;
      if(first?.type==='paragraph'&&first.children[0]?.type==='text'&&start!==undefined&&/^\[[+-]\]/.test(source.slice(start)))result={marker:start+1,open:source[start+1]==='+'};
    }
    if('children' in node)for(const child of node.children)visit(child as RootContent);
  };
  for(const node of parser.parse(source).children)visit(node);
  return result;
}
