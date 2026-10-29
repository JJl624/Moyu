const fs=require('node:fs/promises'),path=require('node:path');
const {atomicIfChanged,eligible}=require('./files.cjs');
const {parseBlocks}=require('../shared/code-documents.mjs');
const {pinnedItems,resultId}=require('../shared/pinned-results.mjs');
class PinnedHTML{
  constructor(results,current){this.results=results;this.current=current;}
  folder(current,document,id){if(!eligible(document)||!/\.(md|markdown)$/i.test(document)||!/^(?!0000)[a-f\d]{4}$/.test(id))throw Error('代码块 ID 无效。');return current.documents.directory(document).then(root=>path.posix.join(root,'results',id));}
  async legacyMetadata(current,folder){
    try {const file=await current.vault.resolve(folder+'/results.json');const stat=await fs.lstat(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw Error('HTML 结果记录无效或过大。');
      const bytes=await fs.readFile(file),record=JSON.parse(bytes.toString('utf8')),items=pinnedItems(record);
      return {file,bytes,items,complete:Array.isArray(record.items)&&record.items.length===items.length};
    }catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  async metadata(current,input,record){
    const folder=await this.folder(current,input.document,input.id);
    record ||= (await current.documents.read(input.document)).documents[input.document];
    if(Object.hasOwn(record?.results||{},input.id))return {items:pinnedItems(record.results[input.id])};
    return {items:(await this.legacyMetadata(current,folder))?.items||[]};
  }
  async saveMetadata(current,input,metadata){
    await current.documents.ensureUnlocked(input.document);
    const map=await current.documents.read(input.document),record=map.documents[input.document];record.results ||= {};
    const root=path.posix.join(record.directory,'results'),legacy=[];
    // Consolidate legacy per-block records on the first actual change, never
    // while viewing. HTML payloads remain ordinary independently synced files.
    for(const entry of await fs.readdir(await current.vault.resolve(root,true),{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;})){
      if(!entry.isDirectory()||entry.isSymbolicLink()||!resultId(entry.name))continue;
      const old=await this.legacyMetadata(current,path.posix.join(root,entry.name));if(!old?.complete)continue;
      legacy.push(old);if(!Object.hasOwn(record.results,entry.name))record.results[entry.name]={items:old.items};
    }
    // Empty entries shadow legacy metadata if cleanup is interrupted.
    record.results[input.id]={items:metadata.items};
    await current.documents.write(map,[input.document]);
    for(const old of legacy){
      try{if((await fs.readFile(old.file)).equals(old.bytes))await fs.unlink(old.file);}
      catch(error){if(error.code!=='ENOENT')console.warn('旧 HTML 结果记录保留：'+old.file,error.message);}
    }
  }
  entry(token){const entry=this.results.contexts.get(token);if(!entry||entry.current!==this.current())throw Error('HTML 结果已关闭。');return entry;}
  state(token){const e=this.entry(token);return {pinned:!!e.pin,height:e.pin?.height||360,pending:!!e.pin?.pending,pinIndex:e.index};}
  async recover(token){const e=this.entry(token);if(!e.pin?.pending)return null;const restored=await this.load({document:e.input.document,markdown:'```js {id='+e.input.id+'}\n\n```'}),artifacts=restored.flatMap(r=>r.artifacts),artifact=artifacts.find(a=>a.pinIndex===e.index);this.results.store.release(artifacts.filter(a=>a!==artifact).map(a=>a.token));return artifact||null;}
  async attach(token,index){const e=this.entry(token),metadata=await this.metadata(e.current,e.input);const pin=metadata.items.find(item=>item.index===index);e.index=index;if(pin)e.pin={...pin,pending:true};return this.state(token);}
  pin({token,pinned,height}){
    const e=this.entry(token),current=e.current;
    return current.vault.mutate(async()=>{
      this.entry(token);const folder=await this.folder(current,e.input.document,e.input.id),meta=await this.metadata(current,e.input);
      meta.items=meta.items.filter(item=>item.index!==e.index);
      if(pinned){
        const item=this.results.store.get(token),bytes=await this.results.store.read(token);
        await current.documents.ensureUnlocked(e.input.document);
        const target=await current.vault.resolve(folder,true);await fs.mkdir(target,{recursive:true});
        const file=String(e.index)+'.html';await atomicIfChanged(await current.vault.resolve(folder+'/'+file,true),bytes);
        const next={index:e.index,file,name:item.name,height:this.height(height),language:e.input.language,code:e.input.code||''};meta.items.push(next);
      }else{
        if(e.pin&&this.results.store.get(token).read)await this.results.store.materialize(token);
      }
      await this.saveMetadata(current,e.input,meta);
      if(!pinned&&e.pin){await fs.unlink(await current.vault.resolve(folder+'/'+e.pin.file,true)).catch(err=>{if(err.code!=='ENOENT')throw err;});
        for(const directory of [folder,path.posix.dirname(folder)])await fs.rmdir(await current.vault.resolve(directory,true)).catch(error=>{if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(error.code))throw error;});}
      e.pin=pinned?meta.items.find(item=>item.index===e.index):null;
      return this.state(token);
    });
  }
  height(value){if(!Number.isFinite(value))return 360;return Math.max(160,Math.min(900,Math.round(value)));}
  resize({token,height}){
    const e=this.entry(token);if(!e.pin)return Promise.resolve(this.state(token));
    return e.current.vault.mutate(async()=>{this.entry(token);if(!e.pin)return this.state(token);const meta=await this.metadata(e.current,e.input),pin=meta.items.find(i=>i.index===e.index);if(pin){const next=this.height(height);if(pin.height!==next){pin.height=next;await this.saveMetadata(e.current,e.input,meta);}e.pin.height=next;}return this.state(token);});
  }
  async load({document,markdown}){
    const current=this.current(),out=[];
    if(typeof markdown!=='string')throw Error('文档内容无效。');
    const record=(await current.documents.read(document)).documents[document];
    const root=path.posix.join(await current.documents.directory(document),'results'),folders=new Set([...Object.keys(record?.results||{}),...await fs.readdir(await current.vault.resolve(root,true)).catch(e=>{if(e.code==='ENOENT')return [];throw e;})]);
    if(!folders.size)return out;
    for(const block of parseBlocks(markdown)){
      if(!block.id||!folders.has(block.id))continue;
      const meta=await this.metadata(current,{document,id:block.id},record);
      if(!Array.isArray(meta.items)||meta.items.length>20)continue;
      const artifacts=[];
      for(const pin of meta.items){
        if(!/^\d+\.html$/.test(pin.file)||!Number.isInteger(pin.index))continue;
        const folder=await this.folder(current,document,block.id),file=await current.vault.resolve(folder+'/'+pin.file,true),stat=await fs.stat(file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!stat)continue;
        const artifact=this.results.store.retainDeferred({kind:'html',name:pin.name||'result.html',mime:'text/html',pinned:true,height:this.height(pin.height),size:stat.size,pinIndex:pin.index},async()=>{
          if(this.current()!==current)throw Error('知识库已切换。');
          const source=await current.vault.resolve(folder+'/'+pin.file);
          return fs.readFile(source);
        });
        const input={document,id:block.id,language:pin.language,code:pin.code};
        this.results.contexts.set(artifact.token,{current,input,context:{files:[]},pin,index:pin.index});artifacts.push(artifact);
      }
      if(artifacts.length)out.push({id:block.id,artifacts});
    }
    return out;
  }
}
module.exports={PinnedHTML};
