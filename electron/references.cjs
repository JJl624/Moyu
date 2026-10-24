const fs=require('node:fs/promises');
const path=require('node:path');
const {atomic,eligible,snapshot,replace}=require('./files.cjs');
const {fault,hash}=require('./vault.cjs');
const {DATA_FOLDER}=require('./vault-paths.cjs');
const {readableNote}=require('./readable-note.cjs');
const {localPath,link,links,rewrite,referencePath}=require('../shared/reference-links.mjs');
class References {
  constructor(vault){this.vault=vault;this.cache=new Map();this.unreadable=new Map();this.last='';this.queue=Promise.resolve();}
  async directory(){const absolute=await this.vault.resolve(DATA_FOLDER,true);await fs.mkdir(absolute,{recursive:true});if((await fs.lstat(absolute)).isSymbolicLink())throw fault('知识库数据不能是符号链接。');return absolute;}
  refresh(state){const task=this.queue.then(()=>this.build(state));this.queue=task.catch(()=>{});return task;}
  async build(state){
    const files=[];function walk(nodes){for(const n of nodes)if(n.kind==='folder')walk(n.children||[]);else if(!n.system&&/\.(md|markdown)$/i.test(n.path))files.push(n);}walk(state.tree);
    const present=new Set(files.map(f=>f.path));for(const p of this.cache.keys())if(!present.has(p))this.cache.delete(p);
    for(const p of this.unreadable.keys())if(!present.has(p))this.unreadable.delete(p);
    const all=[];const flatten=nodes=>nodes.forEach(n=>n.kind==='folder'?flatten(n.children||[]):all.push(n.path));flatten(state.tree);const inventory=all.slice().sort().join('\n'),inventoryChanged=inventory!==this.inventory;
    for(const file of files){
      const old=this.cache.get(file.path), skipped=this.unreadable.get(file.path);
      if(old?.updated===file.updated&&old.size===file.size){
        if(inventoryChanged&&old.wiki?.length)old.targets=[...new Set([...old.local,...(await Promise.all(old.wiki.map(node=>referencePath(file.path,node,all)))).filter(Boolean)])];
        continue;
      }
      if(skipped?.updated===file.updated&&skipped.size===file.size)continue;
      const doc=await readableNote(this.vault,file.path,message=>this.unreadable.set(file.path,{updated:file.updated,size:file.size,message}));
      if(!doc){this.cache.delete(file.path);continue;}
      this.unreadable.delete(file.path);
      const nodes=await links(doc.content),wiki=nodes.filter(n=>['wikiEmbed','wikiLink'].includes(n.type)).map(({type,url})=>({type,url})),local=[...new Set(nodes.filter(n=>!['wikiEmbed','wikiLink'].includes(n.type)).map(n=>localPath(file.path,n.url)).filter(Boolean))];
      const targets=[...new Set([...local,...(await Promise.all(wiki.map(n=>referencePath(file.path,n,all)))).filter(Boolean)])];this.cache.set(file.path,{updated:doc.updated,size:file.size,targets,local,wiki});
    }
    this.inventory=inventory;
    const documents={},attachments={};for(const [p,value] of [...this.cache].sort(([a],[b])=>a.localeCompare(b))){documents[p]=value.targets;for(const target of value.targets)(attachments[target] ||= []).push(p);}
    const content=JSON.stringify({version:1,documents,attachments},null,2),file=path.join(this.vault.root,DATA_FOLDER,'attachment_map.json');if(!this.vault.recoveryError&&(content!==this.last||!await fs.lstat(file).catch(()=>null))){await this.directory();let disk;try{disk=await fs.readFile(file,'utf8');}catch{}if(disk!==content)await atomic(file,content);this.last=content;}return {documents,attachments};
  }
  async recover(){
    const dir=await this.directory(),file=path.join(dir,'rename-transaction.json');let record;try{record=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return;throw e;}
    await this.rollback(record);await fs.unlink(file);
  }
  async rollback(record){
    for(const edit of record.edits){const original=await snapshot(this.vault,edit.original),relative=original?edit.original:edit.path,existing=original||await snapshot(this.vault,relative);if(existing?.version===hash(edit.after))await replace(this.vault,relative,Buffer.from(edit.before),existing.version);else if(existing?.version!==hash(edit.before))throw fault('重命名恢复遇到外部修改，请检查 .data/rename-transaction.json。');}
    for(const move of [...(record.moves||[{from:record.from,to:record.to}])].reverse()){
      const source=await this.vault.resolve(move.from,true),target=await this.vault.resolve(move.to,true),hasFrom=await fs.lstat(source).catch(()=>null),hasTo=await fs.lstat(target).catch(()=>null);
      if(process.platform==='win32'&&source.toLowerCase()===target.toLowerCase()){if(!hasTo)throw fault('大小写重命名恢复文件不存在。');await fs.rename(target,source);continue;}
      if(!hasFrom&&hasTo)await fs.rename(target,source);else if(!hasFrom||hasTo)throw fault('重命名恢复路径冲突，请检查 .data/rename-transaction.json。');
    }
    if(record.history)await this.vault.history.rollback(record.history);
    for(const file of record.configuration||[]){
      if(!['vault-settings.json','document_map.json'].includes(file.name))throw fault('恢复配置名称无效。');
      const target=path.join(file.name==='document_map.json'?await this.directory():this.vault.dataDirectory||await this.directory(),file.name),stat=await fs.lstat(target).catch(()=>null);if(stat?.isSymbolicLink())throw fault('恢复配置不能是符号链接。');const current=await fs.readFile(target,'utf8').catch(()=>null);if(current!==file.after&&current!==file.before)throw fault('配置已被外部修改，请检查重命名事务。');if(file.before===null)await fs.unlink(target).catch(e=>{if(e.code!=='ENOENT')throw e;});else await atomic(target,file.before);
    }
  }
  rename(input){return this.vault.mutate(()=>this.renameUnlocked(input));}
  async renameUnlocked(input,commit,configuration=[]){
    const moves=(input.moves||[{from:input.from,to:input.to}]).filter(m=>m.from!==m.to),locations=[];
    for(const move of moves){const {from,to}=move;if(!(eligible(from)&&eligible(to)||move.history===true&&from.startsWith(DATA_FOLDER+'/history/')&&to.startsWith(DATA_FOLDER+'/history/')&&eligible(from.slice((DATA_FOLDER+'/history/').length))&&eligible(to.slice((DATA_FOLDER+'/history/').length)))||to.startsWith(from+'/')||moves.some(m=>m!==move&&(from.startsWith(m.from+'/')||to===m.to||to===m.from||to.startsWith(m.from+'/'))))throw fault('重命名路径无效或重叠。');const source=await this.vault.resolve(from),target=await this.vault.resolve(to,true);if(await fs.lstat(target).catch(()=>null)&&!(process.platform==='win32'&&source.toLowerCase()===target.toLowerCase()))throw fault('这个名称已经存在。','EEXIST');locations.push({source,target,to});}
    const state=await this.vault.list();await this.refresh(state);const plans=[],buffers=[],files=[];const flatten=nodes=>nodes.forEach(n=>n.kind==='folder'?flatten(n.children||[]):files.push(n.path));flatten(state.tree);
    const remap=p=>{const move=moves.find(m=>p===m.from||p.startsWith(m.from+'/'));return move?move.to+p.slice(move.from.length):p;};
    for(const document of this.cache.keys()){
      const disk=await this.vault.read(document),after=await rewrite(disk.content,document,moves,undefined,files);
      if(after!==disk.content)plans.push({path:remap(document),original:document,before:disk.content,after,version:disk.version});
    }
    for(const override of input.overrides||[]){const disk=await this.vault.read(override.path);if(disk.version!==override.version)throw fault('文档已在外部修改。','CONFLICT',disk);const existing=plans.find(p=>p.original===override.path);if(existing)existing.after=override.content;else if(disk.content!==override.content)plans.push({path:remap(override.path),original:override.path,before:disk.content,after:override.content,version:disk.version});}
    for(const buffer of input.buffers||[]){
      if(typeof buffer.content!=='string')throw fault('文档无效。');
      if(/\.(md|markdown)$/i.test(buffer.path)){
        const disk=await this.vault.read(buffer.path);if(disk.version!==buffer.version)throw fault('文档已在外部修改，请先处理冲突：'+buffer.path,'CONFLICT',disk);
        buffers.push({original:buffer.path,path:remap(buffer.path),content:await rewrite(buffer.content,buffer.path,moves,undefined,files)});
      }
    }
    const record={moves,edits:plans,configuration,...(input.history?{history:input.history}:{})},journal=path.join(await this.directory(),'rename-transaction.json');await atomic(journal,JSON.stringify(record,null,2));
    let committed=false;
    try{
      for(const location of locations){await fs.mkdir(path.dirname(location.target),{recursive:true});await this.vault.resolve(location.to,true);await fs.rename(location.source,location.target);}
      for(const plan of plans)await replace(this.vault,plan.path,Buffer.from(plan.after),plan.version);
      if(record.history)await this.vault.history.apply(record.history);
      if(commit)await commit();
      const documents=[];for(const plan of plans)documents.push(await this.vault.read(plan.path));
      for(const b of buffers)if(!documents.some(d=>d.path===b.path))documents.push(await this.vault.read(b.path));
      await fs.unlink(journal);committed=true;if(record.history)await this.vault.history.finalize(record.history).catch(()=>{});this.cache.clear();await this.refresh(await this.vault.list());return {path:input.to,moves,documents,buffers};
    }catch(error){if(committed)throw error;try{await this.rollback(record);await fs.unlink(journal);}catch(recovery){throw fault(error.message+'；'+recovery.message);}throw error;}
  }
}
module.exports={References,localPath,link,links,rewrite,referencePath};
