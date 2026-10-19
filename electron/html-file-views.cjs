const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const {isVaultData}=require('./vault-paths.cjs');
const types={html:'text/html; charset=utf-8',htm:'text/html; charset=utf-8',css:'text/css',js:'text/javascript',mjs:'text/javascript',json:'application/json',svg:'image/svg+xml',png:'image/png',apng:'image/apng',jpg:'image/jpeg',jpeg:'image/jpeg',jfif:'image/jpeg',pjpeg:'image/jpeg',pjp:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',bmp:'image/bmp',ico:'image/x-icon',cur:'image/x-icon',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',mp4:'video/mp4',webm:'video/webm'};
const policy="default-src 'none'; script-src moyu-preview: 'unsafe-inline' 'unsafe-eval' blob:; style-src moyu-preview: 'unsafe-inline'; img-src moyu-preview: data: blob:; font-src moyu-preview: data:; media-src moyu-preview: data: blob:; connect-src moyu-preview:; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";
class HTMLFileViews{
  constructor(current){this.current=current;this.views=new Map();}
  async open({path:relative,content}){
    if(!/\.html?$/i.test(relative)||typeof content!=='string'||Buffer.byteLength(content)>20*1024*1024||isVaultData(relative))throw Error('HTML 文件无效。');
    const vault=this.current();await vault.resolve(relative);
    const token=randomUUID();this.views.set(token,{vault,relative,content});
    while(this.views.size>8)this.views.delete(this.views.keys().next().value);
    return {token,url:'moyu-preview://'+token+'/'+relative.split('/').map(encodeURIComponent).join('/')};
  }
  close(token){this.views.delete(token);}
  async response(request){
    try{
      const url=new URL(request.url),view=this.views.get(url.hostname);
      if(request.method!=='GET'||!view||view.vault!==this.current())throw Error();
      const relative=decodeURIComponent(url.pathname.slice(1));
      const mime=types[path.extname(relative).slice(1).toLowerCase()];
      if(!mime||isVaultData(relative))throw Error();
      let bytes;
      if(relative===view.relative)bytes=Buffer.from(view.content);
      else{const target=await view.vault.resolve(relative),stat=await fs.stat(target);if(!stat.isFile()||stat.size>20*1024*1024)throw Error();bytes=await fs.readFile(target);}
      return new Response(bytes,{headers:{'Content-Type':mime,'Content-Security-Policy':policy,'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }catch{return new Response('文件不可用',{status:404});}
  }
}
module.exports={HTMLFileViews,policy};
