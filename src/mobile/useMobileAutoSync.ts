import {useEffect,useRef,useState} from 'react';
import type {OpenDocument} from '../types';
import {policy,type SyncPolicy} from '../../shared/sync-policy.mjs';
import {mobileFeature,refreshAndroidWorkspace} from './native';
import {MobileSyncJob} from './sync';
import {currentSyncOperation,readSummary,syncKey,writeSummary,type SyncConfig} from './syncState';
import {automaticSyncGap,requestBudget} from '../../shared/sync-requests.mjs';

/** Coalesced foreground work. A busy sync never consumes a later save request. */
export function useMobileAutoSync(root:string,documents:Record<string,OpenDocument>,enabled:boolean,reportError?:(message:string)=>void){
  const [revision,setRevision]=useState(0),[connection,setConnection]=useState<{root:string;value:SyncConfig}|null>(null);
  const config=connection?.root===root?connection.value:null;
  const scopeState=useRef({root,config});scopeState.current={root,config};
  const active=useRef(enabled),foreground=useRef(document.visibilityState!=='hidden'),generation=useRef(0),lifecycle=useRef(0);
  const job=useRef<MobileSyncJob|null>(null),running=useRef(false),pending=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const settings=useRef<SyncPolicy|null>(null),seen=useRef(''),resumes=useRef(0),seenResume=useRef(0),savedBeforeConfig=useRef(false);
  const previousDocuments=useRef({root,documents}),failure=useRef(reportError);failure.current=reportError;active.current=enabled;
  const lastStarted=useRef(-Infinity),covered=useRef(''),latestDocuments=useRef(documents);latestDocuments.current=documents;
  const hasDrafts=()=>Object.values(latestDocuments.current).some(doc=>doc.dirty||doc.saving);
  const wake=useRef<()=>void>(()=>{}),request=useRef<()=>void>(()=>{});
  const clear=()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;};

  // Listen before configuration is available, including while settings are open.
  useEffect(()=>{
    const pause=()=>{foreground.current=false;lifecycle.current++;pending.current=false;clear();job.current?.cancel();};
    const resume=()=>{foreground.current=true;resumes.current++;if(settings.current?.onOpen)request.current();else wake.current();};
    const visibility=()=>{if(document.visibilityState==='hidden')pause();else resume();};
    const completed=()=>{const operation=currentSyncOperation();if(operation?.root===scopeState.current.root&&operation.kind==='sync'&&operation.full&&covered.current!==operation.id){covered.current=operation.id;lastStarted.current=Date.now();pending.current=false;clear();}if(!operation)wake.current();};
    const changed=()=>setRevision(value=>value+1);
    window.addEventListener('moyu-mobile-pause',pause);window.addEventListener('moyu-mobile-resume',resume);
    window.addEventListener('moyu-mobile-sync-progress',completed);window.addEventListener('moyu-mobile-sync-config',changed);
    document.addEventListener('visibilitychange',visibility);
    return()=>{pause();window.removeEventListener('moyu-mobile-pause',pause);window.removeEventListener('moyu-mobile-resume',resume);window.removeEventListener('moyu-mobile-sync-progress',completed);window.removeEventListener('moyu-mobile-sync-config',changed);document.removeEventListener('visibilitychange',visibility);};
  },[]);
  useEffect(()=>{
    if(!root||!enabled)return;let alive=true;
    void mobileFeature<SyncConfig>('mobile.webdav-config',{root}).then(value=>{if(alive)setConnection(previous=>previous?.root===root&&JSON.stringify(previous.value)===JSON.stringify(value)?previous:{root,value});}).catch(error=>{if(alive)failure.current?.((error as Error).message);});
    return()=>{alive=false;};
  },[root,enabled,revision]);

  useEffect(()=>{
    const ticket=++generation.current;clear();job.current?.cancel();settings.current=null;wake.current=()=>{};
    // Requests made during a save or configuration load may still be pending.
    request.current=()=>{pending.current=true;clear();wake.current();};
    if(!enabled||!config?.url)return;
    let value:SyncPolicy,budget:ReturnType<typeof requestBudget>;
    try{value=policy(config.sync);budget=requestBudget(config.url,config.username);}catch(error){failure.current?.('请填写有效的 HTTPS 服务地址。');return;}
    settings.current=value;
    const valid=()=>generation.current===ticket&&active.current&&scopeState.current.root===root&&scopeState.current.config===config;
    const canRun=()=>valid()&&foreground.current&&document.visibilityState!=='hidden'&&!hasDrafts();
    const perform=async()=>{
      timer.current=null;
      if(!pending.current||!canRun()||running.current||currentSyncOperation())return;
      pending.current=false;running.current=true;const started=lifecycle.current;let current:MobileSyncJob|null=null,key='';
      try{
        key=await syncKey(root,config);
        // Hashing and preference I/O yield to pause/root/connection changes.
        if(!canRun()||started!==lifecycle.current)return;
        if(currentSyncOperation()){pending.current=true;return;}
        if(!readSummary(key).lastSync){await writeSummary(key,{needsConfirmation:true});return;}
        current=new MobileSyncJob(config,root,()=>{});job.current=current;
        await current.run();if(valid())await refreshAndroidWorkspace();
      }catch(error){
        if(valid()&&started===lifecycle.current&&(error as {code?:string}).code==='RATE_LIMITED')pending.current=true;
        // A network job records its own failure; only preflight errors need a report here.
        if(valid()&&started===lifecycle.current&&!current){if(key)await writeSummary(key,{error:(error as Error).message}).catch(()=>{});else failure.current?.((error as Error).message);}
      }finally{
        if(job.current===current)job.current=null;running.current=false;wake.current();
      }
    };
    wake.current=()=>{if(pending.current&&canRun()&&!timer.current){const wait=Math.max(1200,lastStarted.current+automaticSyncGap-Date.now(),budget.retryAt-Date.now());timer.current=setTimeout(()=>void perform(),Math.min(2147483647,wait));}};
    const scope=JSON.stringify([root,config.url,config.directory,config.username,value.onOpen,value.afterSave,value.interval]);
    if(scope!==seen.current){seen.current=scope;pending.current=value.onOpen;}
    if(seenResume.current!==resumes.current){seenResume.current=resumes.current;if(value.onOpen)pending.current=true;}
    if(savedBeforeConfig.current){savedBeforeConfig.current=false;if(value.afterSave)pending.current=true;}
    wake.current();
    const interval=value.interval?setInterval(()=>request.current(),value.interval*60000):null;
    return()=>{generation.current++;clear();if(interval)clearInterval(interval);job.current?.cancel();};
  },[root,config,enabled]);

  useEffect(()=>{
    const previous=previousDocuments.current;previousDocuments.current={root,documents};
    if(previous.root!==root){pending.current=false;savedBeforeConfig.current=false;return;}
    if(!enabled)return;
    const saved=Object.values(documents).some(doc=>!doc.dirty&&!doc.saving&&previous.documents[doc.path]?.version!==doc.version&&(previous.documents[doc.path]?.dirty||previous.documents[doc.path]?.saving));
    if(saved){if(!settings.current)savedBeforeConfig.current=true;else if(settings.current.afterSave)request.current();}
    if(Object.values(documents).some(doc=>doc.dirty||doc.saving)){clear();if(job.current){pending.current=true;job.current.cancel();}return;}
    wake.current();
  },[root,documents,config,enabled]);
}
