const {randomUUID}=require('node:crypto');
const cancelled=()=>Object.assign(new Error('已取消下载。'),{code:'DOWNLOAD_CANCELLED'});
class DownloadTasks {
  constructor(publish=()=>{}){this.jobs=new Map();this.publish=publish;}
  state(scope){return this.jobs.get(scope)?.state||null;}
  cancel(scope,id){const job=this.jobs.get(scope);if(!job||id!==job.state.id||job.state.status!=='running'||!job.state.cancellable)return false;job.state.status='cancelling';job.controller.abort(cancelled());job.notify(true);return true;}
  async close(){this.closed=true;const jobs=[...this.jobs.values()];for(const job of jobs)this.cancel(job.state.scope,job.state.id);await Promise.all(jobs.map(job=>job.done));}
  async run(scope,label,action){
    if(this.closed)throw cancelled();
    const previous=this.jobs.get(scope);if(previous&&['running','cancelling'].includes(previous.state.status))throw Error('请等待当前下载操作完成。');
    const controller=new AbortController(),state={id:randomUUID(),scope,label,status:'running',phase:'准备下载',file:'',received:0,total:null,transferred:0,cancellable:true};
    const job={controller,state,last:0,timer:null,notify:force=>{const elapsed=Date.now()-job.last;if(force||elapsed>=120){clearTimeout(job.timer);job.timer=null;job.last=Date.now();this.publish({...state});}else if(!job.timer){job.timer=setTimeout(()=>job.notify(true),120-elapsed);job.timer.unref();}},check:()=>{if(controller.signal.aborted)throw cancelled();},phase:text=>{job.check();state.phase=text;job.notify(true);},file:(name,total=null)=>{job.check();Object.assign(state,{phase:label.startsWith('导入')?'复制与校验':'下载',file:name,received:0,total:Number.isFinite(total)&&total>0?total:null});job.notify(true);},advance:received=>{job.check();state.transferred+=Math.max(0,received-state.received);state.received=received;job.notify(false);},commit:()=>{job.check();state.cancellable=false;state.phase='正在完成';job.notify(true);}};
    let finish;job.done=new Promise(resolve=>{finish=resolve;});this.jobs.set(scope,job);job.notify(true);
    try{const result=await action(job);state.status='completed';return result;}
    catch(error){state.status=controller.signal.aborted?'cancelled':'failed';if(controller.signal.aborted)throw cancelled();throw error;}
    finally{state.cancellable=false;job.notify(true);finish();}
  }
}
async function readDownload(response,limit,job,name){
  const length=Number(response.headers.get('content-length')),encoding=response.headers.get('content-encoding');
  const known=!encoding||encoding==='identity';if(known&&length>limit){await response.body?.cancel();throw Error('下载文件超过大小限制。');}
  job?.file(name,known&&length>0?length:null);const chunks=[];let received=0;
  for await(const chunk of response.body||[]){job?.check();received+=chunk.length;if(received>limit)throw Error('下载文件超过大小限制。');chunks.push(chunk);job?.advance(received);}
  job?.check();return Buffer.concat(chunks,received);
}
module.exports={DownloadTasks,readDownload,cancelled};
