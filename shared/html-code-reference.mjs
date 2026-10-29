/** Only a whole HTML code block containing a file reference is a document link. */
export function htmlCodeReference(code){
  const value=code.trim(),offset=code.indexOf(value);
  const explicit=/^src\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s<>]+))$/i.exec(value);
  if(explicit){const href=explicit[1]||explicit[2]||explicit[3],quote=explicit[1]?'"':explicit[2]?"'":'',from=quote?value.indexOf(quote)+1:value.length-href.length;return{href,from:offset+from,to:offset+from+href.length,quote};}
  const quote=/^(["']).*\1$/.test(value)?value[0]:'',href=quote?value.slice(1,-1):value;
  if(!/^[^<>\r\n]+\.html?$/i.test(href))return null;
  return{href,from:offset+(quote?1:0),to:offset+value.length-(quote?1:0),quote};
}
