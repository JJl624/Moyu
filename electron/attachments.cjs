const fs=require('node:fs/promises');
const path=require('node:path');
const {eligible}=require('./files.cjs');
const {fault}=require('./vault.cjs');
const filename=value=>{const name=String(value||'').trim();if(!name||name.includes('/')||name.includes('\\')||!eligible(name))throw fault('附件文件名无效。');return name;};
const {relativeHref:relative}=require('../shared/link-destinations.mjs');
class Attachments {
  constructor(vault){this.vault=vault;this.documents=new(require('./document-map.cjs').DocumentMap)(vault);}
  async directory(document){
    if(/\.(md|markdown)$/i.test(document))return path.posix.join(await this.documents.directory(document),'attachments');
    if(eligible(document)&&/\.excalidraw$/i.test(document))return path.posix.dirname(document);
    throw fault('请选择 Markdown 文档。');
  }
  target(document,name){return this.vault.mutate(()=>this.targetUnlocked(document,name));}
  async targetUnlocked(document,name){if(document&&/\.(md|markdown)$/i.test(document))await this.documents.ensureUnlocked(document);const directory=await this.directory(document||'');return path.posix.join(directory==='.'?'':directory,filename(name));}
  async put(document,name,bytes){
    filename(name);if(!ArrayBuffer.isView(bytes))throw fault('附件内容无效。');
    const original=await this.targetUnlocked(document,name),extension=path.posix.extname(name),stem=path.posix.basename(name,extension);let target=original;
    for(let index=0;;index++){
      target=index?path.posix.join(path.posix.dirname(original),stem+'-'+index+extension):original;
      const absolute=await this.vault.resolve(target,true);await fs.mkdir(path.dirname(absolute),{recursive:true});await this.vault.resolve(target,true);
      try{await fs.writeFile(absolute,bytes,{flag:'wx',flush:true});break;}catch(e){if(e.code!=='EEXIST')throw e;}
    }
    return {path:target,link:relative(document||'文档.md',target)};
  }
  upload(input){return this.vault.mutate(()=>this.put(input.document||'',input.name,input.bytes));}
  async list(input={}){
    const {links,referencePath}=require('./references.cjs');
    const state=this.state||await this.vault.list(),files=[];const flatten=nodes=>nodes.forEach(n=>n.kind==='file'?files.push(n):flatten(n.children||[]));flatten(state.tree);
    const refs=new Map(),occurrences=new Map();
    if(input.document)await this.vault.resolve(input.document);
    for(const file of input.document?[{path:input.document}]:files.filter(f=>/\.(md|markdown)$/i.test(f.path)&&!f.system)){
      const content=input.document&&typeof input.content==='string'?input.content:(await this.vault.read(file.path)).content;
      for(const node of await links(content)){const target=await referencePath(file.path,node,files);if(target){const set=refs.get(target)||new Set();set.add(file.path);refs.set(target,set);if(input.document&&node.type!=='definition'){const positions=occurrences.get(target)||[];positions.push({from:node.position.start.offset,to:node.position.end.offset});occurrences.set(target,positions);}}}
    }
    const candidates=new Map(files.filter(f=>!f.system&&!/\.(md|markdown)$/i.test(f.path)&&eligible(f.path)&&(!input.document||refs.has(f.path))).map(f=>[f.path,f]));
    for(const target of refs.keys())if(eligible(target)&&!/^\.data\//.test(target)&&! /\.(md|markdown)$/i.test(target)&&!candidates.has(target))candidates.set(target,{path:target,name:path.posix.basename(target),kind:'file'});
    return (await Promise.all([...candidates].map(async([target,file])=>{let stat;try{stat=await fs.stat(await this.vault.resolve(target,true));}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))return null;}if(stat&&!stat.isFile())return null;return {...file,size:stat?.size||0,exists:!!stat,references:[...refs.get(target)||[]],occurrences:occurrences.get(target)||[]};}))).filter(Boolean);
  }
}
module.exports={Attachments,relative};

