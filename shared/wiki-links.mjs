// One parser for the editor, reading view and disk reference index. Only text
// nodes are scanned; fenced/inline code, math and escaped examples stay literal.
export function wikiSyntax(tree, content) {
  const point = offset => ({offset});
  const walk = node => {
    if (!node.children || ['code','inlineCode','math','inlineMath','html'].includes(node.type)) return;
    node.children = node.children.flatMap(child => {
      if (child.type !== 'text' || child.position?.start.offset === undefined) {walk(child);return [child];}
      const base=child.position.start.offset, raw=content.slice(base,child.position.end.offset), out=[];let cursor=0;
      for(const match of raw.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
        const index=match.index, slash=raw.slice(0,index).match(/\\+$/)?.[0].length||0;if(slash%2)continue;
        const separator=match[2].indexOf('|'),target=(separator<0?match[2]:match[2].slice(0,separator)).trim(),parameter=separator<0?'':match[2].slice(separator+1).trim();
        if(!target||/^[a-z][\w+.-]*:|^[\/\\]/i.test(target))continue;
        if(index>cursor)out.push({type:'text',value:raw.slice(cursor,index),position:{start:point(base+cursor),end:point(base+index)}});
        out.push({type:match[1]?'wikiEmbed':'wikiLink',url:target,parameter,value:match[0],children:[{type:'text',value:parameter||target}],position:{start:point(base+index),end:point(base+index+match[0].length)}});cursor=index+match[0].length;
      }
      if(!out.length)return [child];if(cursor<raw.length)out.push({type:'text',value:raw.slice(cursor),position:{start:point(base+cursor),end:point(base+raw.length)}});return out;
    });
  };walk(tree);return tree;
}
export function wikiDimensions(parameter='') {
  const match=/^(\d+)(?:x(\d+))?$/.exec(parameter);
  return match?{width:Math.min(10000,Math.max(1,Number(match[1]))),height:match[2]?Math.min(10000,Math.max(1,Number(match[2]))):undefined}:null;
}
export function wikiPath(document, target, files=[]) {
  const name=target.split('#')[0].replaceAll('\\','/');if(!name||/^([a-z][\w+.-]*:|\/)/i.test(name))return '';
  const normalize=value=>{const parts=[];for(const part of value.split('/')){if(part==='..'){if(!parts.length)return '';parts.pop();}else if(part&&part!=='.')parts.push(part);}return parts.join('/');};
  const exact=[name,!/\.[^/]+$/.test(name)?name+'.md':''].filter(Boolean).map(normalize);
  // Obsidian paths are rooted at the vault. Bare names can find a unique file
  // anywhere in it; never guess between two matching files.
  const paths=files.map(file=>typeof file==='string'?file:file.path),found=exact.find(p=>paths.includes(p));if(found)return found;
  const relative=normalize([...document.split('/').slice(0,-1),name].join('/'));if(paths.includes(relative))return relative;
  if(!name.includes('/')){const matches=paths.filter(p=>exact.some(n=>p===n||p.endsWith('/'+n)));if(matches.length===1)return matches[0];}
  return exact[0]||relative;
}
export const wikiEmbed=(target,parameter='')=>'![['+target+(parameter?'|'+parameter:'')+']]';
