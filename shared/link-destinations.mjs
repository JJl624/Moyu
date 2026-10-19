// Keep Markdown destinations readable; encode only URL separators and literal
// percent signs. Native asset URLs still use their own transport encoding.
const unicodeBytes=/%[cd][0-9a-f](?:%[89ab][0-9a-f])|%e[0-9a-f](?:%[89ab][0-9a-f]){2}|%f[0-4](?:%[89ab][0-9a-f]){3}/gi;
const localBytes=/%(?:20|21|27|28|29|2a|2c|5b|5d|60|7b|7d)/gi;
export function readableHref(href) {
  const local=!/^([a-z][\w+.-]*:|\/\/|#)/i.test(href);
  const text=href.replace(unicodeBytes,bytes=>{try{const value=decodeURIComponent(bytes);return /[\u0000-\u001f\u007f]/.test(value)||!local&&/\s/.test(value)?bytes:value;}catch{return bytes;}});
  return local?text.replace(localBytes,bytes=>decodeURIComponent(bytes)):text;
}
export function relativeHref(document,target) {
  const from=document.split('/').slice(0,-1),to=target.split('/');
  while(from.length&&from[0]===to[0]){from.shift();to.shift();}
  return [...from.map(()=>'..'),...to].join('/').replace(/[%#?\\]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
}
export function markdownDestination(href,angle=false) {
  const escaped=href.replace(/[\\<>]/g,'\\$&').replace(/&(?=#\d+;|#x[\da-f]+;|[a-z][\da-z]+;)/gi,'\\&');
  return angle||/[\s()<>]/.test(href)?'<'+escaped+'>':escaped;
}
// The span includes angle delimiters, so a rename can turn a bare destination
// into a space-containing destination without changing labels or titles.
export function destinationSpan(raw,definition=false) {
  let depth=0,close=-1,ticks='';
  for(let i=raw.indexOf('[');i>=0&&i<raw.length;i++){
    const c=raw[i];if(c==='\\'){i++;continue;}
    if(c==='`'&&!definition){const run=raw.slice(i).match(/^`+/)[0];if(!ticks&&[...raw.slice(i+run.length).matchAll(/`+/g)].some(m=>m[0]===run))ticks=run;else if(ticks===run)ticks='';i+=run.length-1;continue;}
    if(ticks)continue;
    if(c==='[')depth++;else if(c===']'&&!--depth){close=i;break;}
  }
  if(close<0||raw[close+1]!== (definition?':':'('))return null;
  let from=close+2;while(/\s/.test(raw[from]||'')&&from<raw.length)from++;
  if(raw[from]==='<'){
    for(let to=from+1;to<raw.length;to++){if(raw[to]==='\\'){to++;continue;}if(raw[to]==='>')return {from,to:to+1,angle:true,contentFrom:from+1,contentTo:to};}
    return null;
  }
  let to=from,nesting=0;while(to<raw.length){const c=raw[to];if(c==='\\'){to+=2;continue;}if(/\s/.test(c))break;if(c==='(')nesting++;if(c===')'){if(!nesting)break;nesting--;}to++;}
  return {from,to,angle:false,contentFrom:from,contentTo:to};
}
export function readableSource(node,markdown) {
  const start=node.position?.start.offset,end=node.position?.end.offset;
  if(start===undefined||end===undefined)return {value:node.value||'',offsets:[]};
  const raw=markdown.slice(start,end),edits=[];
  const walk=child=>{
    if(['link','image','definition'].includes(child.type)&&child.position){
      const base=child.position.start.offset,source=markdown.slice(base,child.position.end.offset),span=destinationSpan(source,child.type==='definition');
      if(span){const original=source.slice(span.contentFrom,span.contentTo),href=readableHref(original);if(href!==original)edits.push({from:base-start+span.from,to:base-start+span.to,value:markdownDestination(href,span.angle)});}
    }
    if(!['code','inlineCode','math','inlineMath','html'].includes(child.type))child.children?.forEach(walk);
  };walk(node);
  let cursor=0,value='',offsets=[];
  const append=(text,at)=>{value+=text;for(let i=0;i<text.length;i++)offsets.push(start+at+i);};
  for(const edit of edits.sort((a,b)=>a.from-b.from)){
    if(edit.from<cursor)continue;append(raw.slice(cursor,edit.from),cursor);
    // Map normalized characters to the original source instead of shifting all
    // following caret positions by the length of a percent-encoded filename.
    const original=raw.slice(edit.from,edit.to);let old=0;
    for(const c of edit.value){let found=original.indexOf(c,old);
      if(found<0){const encoded=encodeURIComponent(c);found=original.toLowerCase().indexOf(encoded.toLowerCase(),old);if(found>=0)old=found+encoded.length;else found=old;}
      else old=found+c.length;
      value+=c;for(let i=0;i<c.length;i++)offsets.push(start+edit.from+Math.min(original.length,found));
    }cursor=edit.to;
  }
  append(raw.slice(cursor),cursor);offsets.push(end);return {value,offsets};
}
