const fs=require('node:fs/promises'),path=require('node:path');
const {atomicIfChanged,eligible}=require('./files.cjs');
const {parseBlocks}=require('../shared/code-documents.mjs');
class PinnedHTML{
  constructor(results,current){this.results=results;this.current=current;}
  folder(current,document,id){if(!eligible(document)||!/\.(md|markdown)$/i.test(document)||!/^(?!0000)[a-f\d]{4}$/.test(id))throw Error('代码块 ID 无效。');return current.documents.directory(document).then(root=>path.posix.join(root,'results',id));}
  async metadata(current,input){const folder=await this.folder(current,input.document,input.id);try{const file=await current.vault.resolve(folder+'/results.json');const stat=await fs.stat(file);if(stat.size>1024*1024)throw Error('结果记录过大。');const meta=JSON.parse(await fs.readFile(file,'utf8'));return {items:Array.isArray(meta?.items)?meta.items.filter(p=>p&&Number.isInteger(p.index)&&p.index>=0&&p.index<20&&p.file===p.index+'.html'&&typeof p.code==='string'&&typeof p.language==='string').slice(0,20):[]};}catch(e){if(e.code==='ENOENT')return {items:[]};throw e;}}
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
        e.pin={index:e.index,file,name:item.name,height:this.height(height),language:e.input.language,code:e.input.code||''};meta.items.push(e.pin);
      }else{
        const item=e.pin;if(item){if(this.results.store.get(token).read)await this.results.store.materialize(token);await fs.unlink(await current.vault.resolve(folder+'/'+item.file,true)).catch(err=>{if(err.code!=='ENOENT')throw err;});}e.pin=null;
      }
      if(meta.items.length)await atomicIfChanged(await current.vault.resolve(folder+'/results.json',true),JSON.stringify(meta,null,2));
      else await fs.unlink(await current.vault.resolve(folder+'/results.json',true)).catch(err=>{if(err.code!=='ENOENT')throw err;});
      return this.state(token);
    });
  }
  height(value){if(!Number.isFinite(value))return 360;return Math.max(160,Math.min(900,Math.round(value)));}
  resize({token,height}){
    const e=this.entry(token);if(!e.pin)return Promise.resolve(this.state(token));
    return e.current.vault.mutate(async()=>{this.entry(token);if(!e.pin)return this.state(token);const meta=await this.metadata(e.current,e.input),pin=meta.items.find(i=>i.index===e.index);if(pin){pin.height=this.height(height);e.pin.height=pin.height;const folder=await this.folder(e.current,e.input.document,e.input.id);await atomicIfChanged(await e.current.vault.resolve(folder+'/results.json'),JSON.stringify(meta,null,2));}return this.state(token);});
  }
  async load({document,markdown}){
    const current=this.current(),out=[];
    if(typeof markdown!=='string')throw Error('文档内容无效。');
    const root=path.posix.join(await current.documents.directory(document),'results'),folders=new Set(await fs.readdir(await current.vault.resolve(root,true)).catch(e=>{if(e.code==='ENOENT')return [];throw e;}));
    if(!folders.size)return out;
    for(const block of parseBlocks(markdown)){
      if(!block.id||!folders.has(block.id))continue;
      const meta=await this.metadata(current,{document,id:block.id});
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
