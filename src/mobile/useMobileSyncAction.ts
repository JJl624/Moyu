import {useEffect,useRef,useState} from 'react';
import {mobileFeature,refreshAndroidWorkspace} from './native';
import {MobileSyncJob,syncResultMessage,type SyncConfig,type SyncConflict} from './sync';
import {currentSyncOperation} from './syncState';
import {useMobileOverwriteConfirmation} from './useMobileOverwriteConfirmation';

export function useMobileSyncAction(root:string,options:{save():Promise<boolean>;refresh():Promise<void>;configure():void;conflicts(value:SyncConflict[]):void;notice(message:string):void;error(message:string):void}){
  const overwrite=useMobileOverwriteConfirmation(root);
  const job=useRef<MobileSyncJob|null>(null),running=useRef(false),live=useRef(true),epoch=useRef(0),[busy,setBusy]=useState(false),latest=useRef(options);latest.current=options;
  useEffect(()=>{live.current=true;epoch.current++;const pause=()=>job.current?.cancel();window.addEventListener('moyu-mobile-pause',pause);return()=>{live.current=false;epoch.current++;pause();window.removeEventListener('moyu-mobile-pause',pause);};},[root]);
  const sync=async()=>{
    if(running.current||currentSyncOperation()||!root)return;const ticket=epoch.current;running.current=true;setBusy(true);
    try{
      if(!await latest.current.save()||ticket!==epoch.current)return;
      const config=await mobileFeature<SyncConfig>('mobile.webdav-config',{root});
      if(ticket!==epoch.current)return;if(!config.url){latest.current.configure();return;}
      const active=new MobileSyncJob(config,root,()=>{},overwrite.confirm,overwrite.confirmScope);job.current=active;
      const result=await active.run();await refreshAndroidWorkspace();
      if(!live.current||ticket!==epoch.current)return;
      if(result.conflicts.length)latest.current.conflicts(result.conflicts);
      else latest.current.notice(syncResultMessage(result));
    }catch(error){if(live.current&&ticket===epoch.current)latest.current.error((error as Error).message);}
    finally{job.current=null;running.current=false;if(live.current)setBusy(false);}
  };
  return {sync,busy,confirmation:overwrite.confirmation};
}
