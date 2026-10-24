import {mobileFeature,refreshMobileWrites} from './native';
import {api} from '../bridge';
import {flatten} from '../types';
import {settingsStore} from '../settingsStore';
import {syncDecision} from '../../shared/sync-decision.mjs';
import {excludedBy,policy,syncEligible} from '../../shared/sync-policy.mjs';
import {sameToken,validator} from '../../shared/sync-validator.mjs';
import {requestBudget} from '../../shared/sync-requests.mjs';
import {beginSyncOperation,endSyncOperation,progressSyncOperation,hashBytes,readBaseline,readSummary,syncKey,syncRootKey,syncURL,writeSummary,type Baseline,type CloudEntry,type SyncConfig} from './syncState';
export type {SyncConfig} from './syncState';
export type Remote=CloudEntry;
export type SyncConflict={path:string;local:string|null;remote:string|null;etag:string;localHash:string|null;remoteBytes:string|null;truncated?:boolean};
export type SyncProgress={stage:string;completed:number;total:number;path:string};
export type OverwriteReview={load(path?:string):Promise<SyncConflict[]>;allowRemote?:boolean};
export type OverwriteChoice=boolean|'remote';
export type ConfirmOverwrite=(paths:string[],destination:string,review?:OverwriteReview)=>OverwriteChoice|Promise<OverwriteChoice>;
export function syncResultMessage(result:{conflicts:SyncConflict[];pendingUploads:string[];uploaded:number;downloaded:number;needsDirectoryConfirmation?:boolean}){
  if(result.needsDirectoryConfirmation)return '同步目录待确认';
  const messages:string[]=[];
  if(result.uploaded||result.downloaded)messages.push(`已上传 ${result.uploaded} 个，下载 ${result.downloaded} 个`);
  if(result.pendingUploads.length)messages.push(result.pendingUploads.length+' 个文件待确认上传');
  if(result.conflicts.length)messages.push(result.conflicts.length+' 个文件需要处理');
  return messages.join('；')||'文件没有变化';
}
type Response={status:number;body:string;etag?:string;modified?:string;retryAfter?:string};
type Download=Response&{hash:string;etag:string;size:number};
const decode=(base64:string)=>Uint8Array.from(atob(base64),character=>character.charCodeAt(0));
const encodePath=(path:string)=>path.split('/').map(encodeURIComponent).join('/');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const statusError=(status:number)=>Object.assign(Error(status===401?'用户名或密码错误。':status===403?'没有访问或写入云端目录的权限。':status===404?'云端文件或目录不存在，请重新检查。':status===412?'云端文件已改变，请重新同步。':status===507?'云端存储空间不足。':'WebDAV 请求失败（HTTP '+status+'）。'),{status});
const propfind='<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>';
const properties=(depth:string)=>({headers:{Depth:depth,'Content-Type':'application/xml; charset=utf-8'},body:propfind});

export class MobileSyncJob {
  readonly id=crypto.randomUUID();
  readonly settings;
  private sequence=0;
  private cancelled=false;
  private base:URL;
  private baseline:Baseline=Object.create(null);
  private key='';
  private cloud=new Map<string,Remote>();
  private knownDirectories=new Set<string>();
  private budget;
  constructor(readonly config:SyncConfig,readonly root:string,readonly progress:(value:SyncProgress)=>void,private readonly confirmOverwrite?:ConfirmOverwrite,private readonly confirmScope?:(destination:string,serviceRoot:boolean)=>boolean|Promise<boolean>){
    this.base=syncURL(config);this.budget=requestBudget(this.base.href,config.username);this.settings=policy(config.sync);const publish=this.progress;this.progress=value=>{publish(value);progressSyncOperation(this.id,value);};
  }
  private async operation<T>(kind:'sync'|'list'|'test',action:()=>Promise<T>,full=false):Promise<T>{beginSyncOperation({id:this.id,root:this.root,kind,full,stage:kind==='sync'?'正在同步':kind==='list'?'读取云端目录':'测试连接',path:'',cancel:()=>this.cancel()});try{return await action();}catch(error){await refreshMobileWrites().catch(()=>{});throw error;}finally{endSyncOperation(this.id);}}
  run(){return this.operation('sync',()=>this.performRun(),true);}
  resolve(conflict:SyncConflict,choice:'local'|'remote'|'both'){return this.operation('sync',()=>this.performResolve(conflict,choice));}
  review(paths:string[]){return this.operation('list',async()=>{await this.loadBaseline();const entries=new Map(readSummary(this.key).remote.map(item=>[item.path,item])),result:SyncConflict[]=[];for(const path of paths){this.check();const local=await mobileFeature<boolean>('file.exists',{path})?await this.readLocal(path):null;const head=await this.request('HEAD',path);if(head.status!==200&&head.status!==404)throw statusError(head.status);const cloud=head.status===200?await this.download({...entries.get(path),path,etag:head.etag||'',size:-1,modified:''}):null;result.push(this.comparison(path,local,cloud));}return result;});}
  test(){return this.operation('test',()=>this.performTest());}
  refreshTree(){return this.operation('list',()=>this.performRefreshTree());}
  cancel(){this.cancelled=true;void mobileFeature('mobile.webdav-cancel',{job:this.id}).catch(()=>{});}
  check(){if(this.cancelled)throw Error('已取消同步。');}
  private async transport(method:string,url:string,options:Record<string,unknown>={}):Promise<Response>{
    for(let attempt=0;;attempt++){
      this.check();
      const reserved=Date.now()+this.budget.reserve();while(Date.now()<reserved){this.check();await pause(Math.min(100,reserved-Date.now()));}this.budget.check();
      try{
        const response=await mobileFeature<Response>('mobile.webdav-request',{id:this.id+'-'+(++this.sequence),url,method,username:this.config.username,password:this.config.password,timeout:this.settings.timeout,...options});
        this.check();
        if(response.status===429||response.status===503&&(response.retryAfter||attempt>=this.settings.retries))throw this.budget.limited(response.status,response.retryAfter);
        if(attempt<this.settings.retries&&[408,500,502,503,504].includes(response.status))throw statusError(response.status);
        this.budget.success();
        return response;
      }catch(error){
        this.check();if((error as {code?:string}).code==='RATE_LIMITED')throw error;const status=(error as {status?:number}).status;
        if(attempt>=this.settings.retries||status&&!([408,429,500,502,503,504].includes(status)))throw error;
        const deadline=Date.now()+(status===503?2000:800)*2**attempt;while(Date.now()<deadline){this.check();await pause(Math.min(100,deadline-Date.now()));}
      }
    }
  }
  request(method:string,path='',options:Record<string,unknown>={}){return this.transport(method,new URL(encodePath(path),this.base).href,options);}
  private async performTest(){const response=await this.request('PROPFIND','',properties('0'));if(response.status===207)return {exists:true};if(response.status!==404)throw statusError(response.status);await this.ensureRoot(false,true);return {exists:false};}
  private async ensureRoot(create=true,knownMissing=false){
    if(!knownMissing){const response=await this.request('PROPFIND','',properties('0'));if(response.status===207)return;if(response.status!==404)throw statusError(response.status);}
    if(Object.keys(this.baseline).length||readSummary(this.key).lastSync)throw Error('云端同步目录不存在，请检查地址。');
    const missing:URL[]=[new URL(this.base)],parent=new URL(this.base);
    while(parent.pathname!=='/'){
      parent.pathname=parent.pathname.replace(/\/$/,'').replace(/[^/]+$/,'');
      const found=await this.transport('PROPFIND',parent.href,properties('0'));
      if(found.status===207){if(create)for(const directory of missing.reverse()){const result=await this.transport('MKCOL',directory.href);if(![201,405].includes(result.status))throw statusError(result.status);}return;}
      if(found.status!==404)throw statusError(found.status);missing.push(new URL(parent));
    }throw statusError(404);
  }
  async list(inspect=false,first?:Response):Promise<Remote[]>{
    const queue=[''],entries=new Map<string,Remote>(),seen=new Set<string>(),excluded=excludedBy(this.settings);
    const baseParts=this.base.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    while(queue.length){
      const path=queue.shift()!;this.check();if(seen.has(path))continue;seen.add(path);
      if(path.split('/').filter(Boolean).length>30||seen.size>2000)throw Error('云端目录层级或数量过多，请选择较小的同步目录。');
      this.progress({stage:'读取云端目录',completed:seen.size-1,total:0,path});
      const result=path===''&&first?first:await this.request('PROPFIND',path,properties('1'));if(result.status!==207)throw statusError(result.status);
      const xml=new DOMParser().parseFromString(result.body,'application/xml');if(xml.querySelector('parsererror'))throw Error('服务器返回了无效的目录数据。');
      for(const response of Array.from(xml.getElementsByTagNameNS('*','response'))){
        const href=response.getElementsByTagNameNS('*','href')[0]?.textContent;if(!href)continue;
        const url=new URL(href,this.base);if(url.origin!==this.base.origin)continue;
        let parts:string[];try{parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);}catch{throw Error('云端返回了无效的文件路径。');}
        if(parts.some(part=>part.includes('/')||part.includes('\\'))||baseParts.some((part,index)=>part!==parts[index]))continue;
        const relative=parts.slice(baseParts.length).join('/');if(!relative||relative===path.replace(/\/$/,''))continue;
        const type=response.getElementsByTagNameNS('*','collection').length?'folder':'file';
        const size=Number(response.getElementsByTagNameNS('*','getcontentlength')[0]?.textContent)||0;
        const reason=!syncEligible(relative)?'不同步':excluded(relative)?'已排除':size>this.settings.maxFileMB*1024*1024?'超过单文件限制':undefined;
        entries.set(relative,{path:relative,type,size,etag:validator(response.getElementsByTagNameNS('*','getetag')[0]?.textContent)||'',modified:response.getElementsByTagNameNS('*','getlastmodified')[0]?.textContent||'',...(reason?{excluded:reason}:{})});
        if(type==='folder'&&syncEligible(relative)&&(!reason||inspect))queue.push(relative+'/');
        if(entries.size>20000)throw Error('云端条目数量超过 20000。');
      }
    }
    this.cloud=entries;
    this.knownDirectories=new Set([...entries.values()].filter(item=>item.type==='folder').map(item=>item.path));
    return [...entries.values()].sort((a,b)=>a.path.localeCompare(b.path,'zh-CN',{numeric:true}));
  }
  private async loadBaseline(){this.key=await syncKey(this.root,this.config);this.baseline=readBaseline(this.key);}
  private async record(path:string,localHash:string,remoteEtag:string){
    const before=this.baseline[path];if(before?.localHash===localHash&&before.remoteEtag===remoteEtag)return;
    this.baseline[path]={localHash,remoteEtag};settingsStore.setItem(this.key,JSON.stringify(this.baseline));await settingsStore.flush();
  }
  private async removeBaseline(path:string){delete this.baseline[path];this.cloud.delete(path);settingsStore.setItem(this.key,JSON.stringify(this.baseline));await settingsStore.flush();}
  private async readLocal(path:string){const result=await mobileFeature<{base64:string;hash?:string;size?:number}>('mobile.read-bytes',{root:this.root,path});if(result.hash&&Number.isSafeInteger(result.size))return{base64:result.base64,hash:result.hash,size:result.size!};const bytes=decode(result.base64);return{base64:result.base64,hash:await hashBytes(bytes),size:bytes.length};}
  private async alternate(path:string,expected:string){
    const response=await this.request('HEAD',path);if(response.status!==200)throw statusError(response.status);
    const tag=validator(response.etag);if(!tag||tag===expected||!sameToken(expected,tag))throw statusError(412);return tag;
  }
  private async download(remote:Remote):Promise<Download>{
    let tag=validator(remote.etag);
    const get=()=>this.request('GET',remote.path,{responseBinary:true,headers:tag?{'If-Match':tag}:{}});
    let result=await get();if(result.status===412&&tag){tag=await this.alternate(remote.path,tag);result=await get();}
    if(result.status!==200)throw statusError(result.status);
    const responseTag=validator(result.etag);if(tag&&responseTag&&!sameToken(tag,responseTag))throw statusError(412);
    const bytes=decode(result.body);if(bytes.length>this.settings.maxFileMB*1024*1024)throw Error('云端文件超过单文件限制：'+remote.path);
    if(remote.size>=0&&remote.size!==bytes.length)throw Error('下载时云端文件大小已改变：'+remote.path);
    return {...result,hash:await hashBytes(bytes),etag:responseTag||tag||'',size:bytes.length};
  }
  private async directories(path:string){
    const parts=path.split('/');parts.pop();let prefix='';
    for(const part of parts){prefix=prefix?prefix+'/'+part:part;if(this.knownDirectories.has(prefix))continue;const result=await this.request('MKCOL',prefix+'/');if(![201,405].includes(result.status))throw statusError(result.status);this.knownDirectories.add(prefix);if(!this.cloud.has(prefix))this.cloud.set(prefix,{path:prefix,type:'folder',etag:'',modified:'',size:0});}
  }
  private async upload(path:string,body:string,remote:Remote|null,expectedRemoteHash?:string,localInfo?:{hash:string;size:number}){
    const bytes=localInfo?null:decode(body),info=localInfo||{hash:await hashBytes(bytes!),size:bytes!.length};
    await this.directories(path);let tag=remote?validator(remote.etag):null;
    if(remote&&!tag)throw Error('服务器未提供有效 ETag，不能安全覆盖云端文件：'+path);
    const put=()=>this.request('PUT',path,{binary:true,body,headers:{'Content-Type':'application/octet-stream',...(remote?{'If-Match':tag!}:{'If-None-Match':'*'})}});
    let response:Response|undefined;
    for(let attempt=0;attempt<2;attempt++){
      let failure:unknown;try{response=await put();}catch(error){failure=error;}
      if(response&&[200,201,204].includes(response.status))break;
      if((failure as {code?:string})?.code==='RATE_LIMITED')throw failure;
      const head=await this.request('HEAD',path);
      if(head.status===200){
        const current=await this.download({path,etag:validator(head.etag)||'',size:-1,modified:''});
        if(current.hash===info.hash)return this.uploaded(path,current);
        if(!attempt&&response?.status===412&&remote&&expectedRemoteHash&&tag&&sameToken(tag,current.etag)&&current.hash===expectedRemoteHash&&tag!==current.etag){tag=current.etag;continue;}
      }
      if(failure)throw failure;throw statusError(response?.status||500);
    }
    if(!response||![200,201,204].includes(response.status))throw statusError(response?.status||500);
    const uploadedTag=validator(response.etag);
    if(uploadedTag)return this.uploaded(path,{...response,hash:info.hash,etag:uploadedTag,size:info.size});
    const verified=await this.download({path,etag:'',size:info.size,modified:''});
    if(verified.hash!==info.hash)throw Error('上传后校验失败：'+path);
    return this.uploaded(path,verified);
  }
  private uploaded(path:string,record:Download){this.cloud.set(path,{path,type:'file',etag:record.etag,size:record.size,modified:record.modified||''});return record.etag;}
  private async apply(path:string,cloud:Download,local:{hash:string}|null){
    await mobileFeature('mobile.write-bytes',{root:this.root,path,base64:cloud.body,...(local?{expected:local.hash}:{})});
    await this.record(path,cloud.hash,cloud.etag);this.cloud.set(path,{path,type:'file',etag:cloud.etag,size:cloud.size,modified:cloud.modified||''});
  }
  private comparison(path:string,local:{base64:string;hash:string}|null,cloud:Download|null):SyncConflict{
    const textual=/\.(md|markdown|txt|html|json|csv|js|ts|py|c|cpp|h|hpp|cs|java|sql|lua|rb|sh|css|excalidraw)$/i.test(path),left=local?decode(local.base64):null,right=cloud?decode(cloud.body):null;
    return {path,local:left?(textual?new TextDecoder().decode(left.slice(0,8192)):'二进制文件'):null,remote:right?(textual?new TextDecoder().decode(right.slice(0,8192)):'二进制文件'):null,localHash:local?.hash||null,etag:cloud?.etag||'',remoteBytes:cloud?.body??null,truncated:textual&&Math.max(left?.length||0,right?.length||0)>8192};
  }
  private async deleteRemote(path:string,remote:Remote,expectedHash:string){
    let tag=validator(remote.etag);if(!tag)throw Error('服务器未提供有效 ETag，不能安全删除云端文件：'+path);
    let result=await this.request('DELETE',path,{headers:{'If-Match':tag}});
    if(result.status===412){tag=await this.alternate(path,tag);const current=await this.download({...remote,etag:tag});if(current.hash!==expectedHash)throw statusError(412);result=await this.request('DELETE',path,{headers:{'If-Match':tag}});}
    if(![200,204,404].includes(result.status))throw statusError(result.status);await this.removeBaseline(path);
  }
  private async performRun():Promise<{conflicts:SyncConflict[];uploaded:number;downloaded:number;remote:Remote[];pendingUploads:string[];needsDirectoryConfirmation?:boolean;skipped:{path:string;reason:string}[]}>{
    await this.loadBaseline();
    try{
      const destination=decodeURI(this.base.href),scopeIsBase=!(this.config.directory||'').split('/').filter(Boolean).length;
      const scopeKey=await syncRootKey(this.root),previousScope=settingsStore.getItem(scopeKey);
      if((scopeIsBase&&settingsStore.getItem(this.key+'-directory-reviewed')!=='1')||(!!previousScope&&previousScope!==this.key)){
        await writeSummary(this.key,{needsDirectoryConfirmation:true});
        const approved=this.confirmScope?await this.confirmScope(destination,scopeIsBase):false;this.check();
        if(!approved)return {conflicts:[],uploaded:0,downloaded:0,remote:readSummary(this.key).remote,pendingUploads:[],needsDirectoryConfirmation:true,skipped:[]};
        settingsStore.setItem(this.key+'-directory-reviewed','1');await settingsStore.flush();
      }
      if(previousScope!==this.key){settingsStore.setItem(scopeKey,this.key);await settingsStore.flush();}
      this.progress({stage:'读取云端目录',completed:0,total:0,path:''});
      let listing=await this.request('PROPFIND','',properties('1'));
      if(listing.status===404){await this.ensureRoot(true,true);listing=await this.request('PROPFIND','',properties('1'));}
      const entries=await this.list(false,listing),workspace=await api.list();if(workspace.root!==this.root)throw Error('知识库已切换。');
      const excluded=excludedBy(this.settings),localFiles=flatten(workspace.tree),local=new Map(localFiles.map(file=>[file.path,file])),remote=new Map(entries.filter(file=>file.type!=='folder').map(file=>[file.path,file]));
      const paths=[...new Set([...local.keys(),...remote.keys(),...Object.keys(this.baseline)])].sort(),folded=new Map<string,string>();
      for(const path of paths){const before=folded.get(path.toLowerCase());if(before&&before!==path)throw Error('文件名在 Windows 上冲突：'+before+' / '+path);folded.set(path.toLowerCase(),path);}
      const conflicts:SyncConflict[]=[],skipped:{path:string;reason:string}[]=[];let uploaded=0,downloaded=0,completed=0;
      const overwrites:{path:string;local:Awaited<ReturnType<MobileSyncJob['readLocal']>>;remote:Remote|null;remoteHash?:string}[]=[];
      for(const path of paths){
        this.check();this.progress({stage:'检查文件变化',completed,total:paths.length,path});
        const file=local.get(path),right=remote.get(path),baseline=this.baseline[path];
        const reason=!syncEligible(path)?'不同步':excluded(path)?'已排除':(file?.size||0)>this.settings.maxFileMB*1024*1024||right?.excluded==='超过单文件限制'?'超过单文件限制':right?.excluded;
        if(reason){skipped.push({path,reason});completed++;continue;}
        const hashes=file?await mobileFeature<Record<string,string>>('mobile.file-hashes',{root:this.root,paths:[path]}):null;
        let left=file?{hash:hashes?.[path]||'',base64:'',size:file.size||0}:null;
        if(left&&!left.hash)throw Error('本地文件已改变，请重新同步：'+path);
        let decision=syncDecision(left?.hash||null,right?baseline&&sameToken(right.etag,baseline.remoteEtag)?baseline.remoteEtag:right.etag||'unknown':null,baseline);
        let cloud:Download|null=null;
        if(right&&(['compare','download','conflict'].includes(decision)||!right.etag)){
          cloud=await this.download(right);
          if(left?.hash===cloud.hash){await this.record(path,left.hash,cloud.etag);decision='unchanged';}
          else if(left&&baseline&&cloud.hash===baseline.localHash)decision='upload';
          else if(left&&baseline&&left.hash===baseline.localHash)decision='download';
        }
        if(baseline&&(!left||!right)&&!(!left&&!right)){
          const unchanged=left?left.hash===baseline.localHash:cloud?.hash===baseline.localHash;
          if(unchanged&&this.settings.deletion==='keep'){skipped.push({path,reason:'未同步删除'});completed++;continue;}
          if(unchanged&&this.settings.deletion==='sync'){
            if(!left&&right&&cloud)await this.deleteRemote(path,{...right,etag:cloud.etag},cloud.hash);
            else if(left&&!right){await mobileFeature('mobile.sync-delete',{root:this.root,path,expected:left.hash});await this.removeBaseline(path);}
            completed++;continue;
          }
          decision='conflict';
        }
        if(!left&&!right){if(baseline)await this.removeBaseline(path);}
        else if(decision==='upload'&&left){
          const current=await this.readLocal(path);if(current.hash!==left.hash)throw Error('本地文件已改变，请重新同步：'+path);left=current;
          if(right)overwrites.push({path,local:left,remote:{...right,etag:cloud?.etag||(baseline&&sameToken(right.etag,baseline.remoteEtag)?baseline.remoteEtag:right.etag)},remoteHash:cloud?.hash||baseline?.localHash});
          else{this.progress({stage:'上传新增文件',completed:uploaded,total:0,path});const tag=await this.upload(path,left.base64,null,undefined,left);await this.record(path,left.hash,tag);uploaded++;}
        }
        else if(decision==='download'&&right){this.progress({stage:'下载已更改文件',completed:downloaded,total:0,path});cloud ||= await this.download(right);await this.apply(path,cloud,left);downloaded++;}
        else if(decision==='compare'||decision==='conflict'){
          if(right&&!cloud)cloud=await this.download(right);
          if(left){const current=await this.readLocal(path);if(current.hash!==left.hash)throw Error('本地文件已改变，请重新同步：'+path);left=current;}
          const text=/\.(md|markdown|txt|html|json|csv|js|ts|py|c|cpp|h|hpp|cs|java|sql|lua|rb|sh|css)$/i.test(path),leftBytes=left?decode(left.base64):null,rightBytes=cloud?decode(cloud.body):null;
          conflicts.push({path,local:leftBytes?(text?new TextDecoder().decode(leftBytes.slice(0,8192)):'二进制文件'):null,remote:rightBytes?(text?new TextDecoder().decode(rightBytes.slice(0,8192)):'二进制文件'):null,etag:cloud?.etag||right?.etag||'',localHash:left?.hash||null,remoteBytes:cloud?.body??null,truncated:text&&Math.max(leftBytes?.length||0,rightBytes?.length||0)>8192});
        }
        completed++;
      }
      let pendingUploads=overwrites.map(item=>item.path);
      if(pendingUploads.length){
        await writeSummary(this.key,{pendingUploads,checkedAt:Date.now(),remote:[...this.cloud.values()],error:''});
        if(this.confirmOverwrite){
          this.check();this.progress({stage:'等待确认覆盖云端',completed,total:paths.length,path:''});
          const previews=new Map<string,Download>();
          const reviewed=async(item:typeof overwrites[number])=>{let cloud=previews.get(item.path);if(!cloud){cloud=await this.download(item.remote!);if(item.remoteHash&&cloud.hash!==item.remoteHash)throw statusError(412);previews.set(item.path,cloud);}return cloud;};
          const approved=await this.confirmOverwrite(pendingUploads,destination,{allowRemote:true,load:async(path)=>Promise.all(overwrites.filter(item=>!path||item.path===path).map(async item=>this.comparison(item.path,item.local,await reviewed(item))))});this.check();
          if(approved){
            // A dialog can remain open while another app edits either side.
            // Validate all local snapshots before writing; conditional PUT still
            // protects each exact remote revision reviewed in this run.
            for(const item of overwrites)if((await this.readLocal(item.path)).hash!==item.local.hash)throw Error('本地文件已改变，请重新同步：'+item.path);
            for(let index=0;index<overwrites.length;index++){
              const item=overwrites[index];this.check();
              if(approved==='remote'){
                const cached=previews.get(item.path);let cloud:Download;
                if(cached){const head=await this.request('HEAD',item.path,{headers:cached.etag?{'If-Match':cached.etag}:{}});if(head.status!==200||!sameToken(head.etag,cached.etag))throw statusError(412);cloud=cached;}
                else cloud=await reviewed(item);
                this.progress({stage:'使用云端文件',completed:index,total:overwrites.length,path:item.path});await this.apply(item.path,cloud,item.local);downloaded++;
              }else{this.progress({stage:'上传已更改文件',completed:index,total:overwrites.length,path:item.path});const tag=await this.upload(item.path,item.local.base64,item.remote,item.remoteHash,item.local);await this.record(item.path,item.local.hash,tag);uploaded++;}
            }
            pendingUploads=[];
          }
        }
      }
      const snapshot=[...this.cloud.values()];await writeSummary(this.key,{lastSync:Date.now(),checkedAt:Date.now(),remote:snapshot,conflicts:conflicts.map(conflict=>conflict.path),pendingUploads,error:'',needsConfirmation:false,needsDirectoryConfirmation:false});
      this.progress({stage:pendingUploads.length?'等待确认上传':`同步完成 · 上传 ${uploaded}，下载 ${downloaded}`,completed:uploaded+downloaded,total:uploaded+downloaded,path:''});return{conflicts,uploaded,downloaded,remote:snapshot,pendingUploads,skipped};
    }catch(error){await writeSummary(this.key,{error:this.cancelled?'':(error as Error).message}).catch(()=>{});throw error;}
  }
  private async performRefreshTree(){await this.loadBaseline();const remote=await this.list(true);await writeSummary(this.key,{checkedAt:Date.now(),remote});return remote;}
  private async performResolve(conflict:SyncConflict,choice:'local'|'remote'|'both'){
    await this.loadBaseline();this.cloud=new Map(readSummary(this.key).remote.map(item=>[item.path,item]));this.knownDirectories=new Set([...this.cloud.values()].filter(item=>item.type==='folder').map(item=>item.path));this.check();
    const path=conflict.path,exists=await mobileFeature<boolean>('file.exists',{path}),local=exists?await this.readLocal(path):null;
    if((local?.hash||null)!==conflict.localHash)throw Error('本地文件已改变，请重新同步。');
    let latest:Download|null=null;
    if(conflict.remoteBytes!==null){
      const bytes=decode(conflict.remoteBytes),expected=await hashBytes(bytes),tag=validator(conflict.etag);
      const head=tag?await this.request('HEAD',path,{headers:{'If-Match':tag}}):null;
      if(head?.status===412)throw statusError(412);
      latest=head?.status===200&&sameToken(head.etag,tag)?{...head,etag:validator(head.etag)!,body:conflict.remoteBytes,hash:expected,size:bytes.length}:await this.download({path,etag:conflict.etag,size:bytes.length,modified:''});
      if(latest.hash!==expected)throw Error('云端文件已改变，请重新同步。');
    }
    else{const head=await this.request('HEAD',path);if(head.status!==404)throw head.status===200?Error('云端文件已改变，请重新同步。'):statusError(head.status);}
    if(choice==='both'&&(!local||!latest))throw Error('删除冲突不能保留两份。');
    if((choice==='local'||choice==='both')&&local&&latest){
      if(!this.confirmOverwrite)return false;
      const decision=await this.confirmOverwrite([path],decodeURI(this.base.href),{allowRemote:choice!=='both',load:async()=>[this.comparison(path,local,latest)]});if(!decision)return false;if(decision==='remote')choice='remote';
      this.check();if((await this.readLocal(path)).hash!==local.hash)throw Error('本地文件已改变，请重新同步。');
    }
    if(choice==='both'&&local&&latest){
      const dot=path.lastIndexOf('.'),hasExtension=dot>path.lastIndexOf('/'),stem=hasExtension?path.slice(0,dot):path,extension=hasExtension?path.slice(dot):'';
      let copy='';for(let index=1;index<=1000;index++){const candidate=stem+'-远端-'+index+extension;if(await mobileFeature<boolean>('file.exists',{path:candidate}))continue;const head=await this.request('HEAD',candidate);if(head.status===404){copy=candidate;break;}if(head.status!==200)throw statusError(head.status);}
      if(!copy)throw Error('无法生成副本名称。');await mobileFeature('mobile.write-bytes',{root:this.root,path:copy,base64:latest.body});const tag=await this.upload(copy,latest.body,null);await this.record(copy,latest.hash,tag);
    }
    if(choice==='local'||choice==='both'){
      if(local){const tag=await this.upload(path,local.base64,latest?{path,etag:latest.etag,size:latest.size,modified:''}:null,latest?.hash);await this.record(path,local.hash,tag);}
      else if(latest)await this.deleteRemote(path,{path,etag:latest.etag,size:latest.size,modified:''},latest.hash);
    }else if(latest)await this.apply(path,latest,local);
    else if(local){await mobileFeature('mobile.sync-delete',{root:this.root,path,expected:local.hash});await this.removeBaseline(path);}
    const summary=readSummary(this.key);if(choice==='remote'){if(latest)this.cloud.set(path,{path,etag:latest.etag,size:latest.size,modified:latest.modified||'',type:'file'});else this.cloud.delete(path);}
    await writeSummary(this.key,{lastSync:Date.now(),remote:[...this.cloud.values()],conflicts:summary.conflicts.filter(name=>name!==path),pendingUploads:summary.pendingUploads.filter(name=>name!==path),error:''});return true;
  }
}
