import {api} from './bridge';
import {resourcePath} from './resourcePreview';
import {htmlPreviewPolicy} from '../shared/html-preview-policy.mjs';
import {htmlCodeReference} from '../shared/html-code-reference.mjs';

export function htmlReference(code:string):string|null {
  return htmlCodeReference(code)?.href??null;
}
export function previewPath(document:string,href:string){
  let decoded=href;try{decoded=decodeURIComponent(href);}catch{throw Error('文件路径编码无效。');}
  if(!decoded||/[\\\0]/.test(decoded)||/^(?:[a-z][\w+.-]*:|\/|#)/i.test(decoded))throw Error('请使用知识库内的相对路径。');
  const path=resourcePath(document,href);
  if(!path)throw Error('文件路径超出了知识库。');
  return path;
}
const mime:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',avif:'image/avif',ico:'image/x-icon',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',mp4:'video/mp4',webm:'video/webm'};

/** Resolve only explicitly referenced files. No directory walk, network request or host API enters the frame. */
export async function htmlPreviewSource(document:string,code:string){
  const reference=htmlReference(code);
  const sourcePath=reference?previewPath(document,reference):document;
  if(reference&&!/\.html?$/i.test(sourcePath))throw Error('请选择 .html 或 .htm 文件。');
  const html=reference?(await api.read(sourcePath)).content:code;
  const parsed=new DOMParser().parseFromString(html,'text/html');
  parsed.querySelectorAll('base,meta[http-equiv="refresh" i]').forEach(node=>node.remove());
  const texts=new Map<string,Promise<string>>(),assets=new Map<string,Promise<string>>();
  const text=(path:string)=>{if(!texts.has(path))texts.set(path,api.read(path).then(file=>file.content));return texts.get(path)!;};
  const asset=(href:string,from=sourcePath)=>{
    if(/^(?:data:|blob:|#)/i.test(href))return Promise.resolve(href);
    const path=previewPath(from,href);
    if(!assets.has(path))assets.set(path,api.assetData(path).then(data=>data.replace(/^data:[^;,]*/, 'data:'+(mime[path.split('.').at(-1)!.toLowerCase()]||'application/octet-stream'))));
    return assets.get(path)!;
  };
  const css=async(value:string,from:string)=>{
    // External imports remain blocked by the frame policy; local url() assets are embedded.
    const matches=[...value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi)];
    let result=value;
    for(const match of matches.reverse()){const url=await asset(match[1]??match[2]??match[3],from);result=result.slice(0,match.index)+`url("${url}")`+result.slice(match.index!+match[0].length);}
    return result;
  };
  for(const node of parsed.querySelectorAll<HTMLElement>('img[src],audio[src],video[src],source[src],video[poster]')){
    for(const key of ['src','poster'])if(node.hasAttribute(key))node.setAttribute(key,await asset(node.getAttribute(key)!));
    node.removeAttribute('srcset');
  }
  for(const node of parsed.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet][href]')){
    const path=previewPath(sourcePath,node.getAttribute('href')!),style=parsed.createElement('style');style.textContent=await css(await text(path),path);node.replaceWith(style);
  }
  for(const node of parsed.querySelectorAll<HTMLScriptElement>('script[src]')){
    const path=previewPath(sourcePath,node.getAttribute('src')!);node.removeAttribute('src');node.removeAttribute('integrity');node.textContent=(await text(path)).replace(/<\/script/gi,'<\\/script');
  }
  for(const node of parsed.querySelectorAll<HTMLElement>('[style]'))node.setAttribute('style',await css(node.getAttribute('style')!,sourcePath));
  for(const node of parsed.querySelectorAll<HTMLStyleElement>('style'))node.textContent=await css(node.textContent||'',sourcePath);
  const csp=parsed.createElement('meta');csp.httpEquiv='Content-Security-Policy';csp.content=htmlPreviewPolicy;parsed.head.prepend(csp);
  if(!parsed.querySelector('meta[name=viewport]')){const viewport=parsed.createElement('meta');viewport.name='viewport';viewport.content='width=device-width,initial-scale=1';csp.after(viewport);}
  return '<!doctype html>\n'+parsed.documentElement.outerHTML;
}
