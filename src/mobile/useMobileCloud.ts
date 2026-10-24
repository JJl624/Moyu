import {useEffect,useState} from 'react';
import {flatten,type FileNode,type OpenDocument} from '../types';
import {excludedBy,policy,syncEligible} from '../../shared/sync-policy.mjs';
import {sameToken} from '../../shared/sync-validator.mjs';
import {mobileFeature} from './native';
import {currentSyncOperation,emptySummary,readBaseline,readSummary,syncKey,type SyncConfig,type SyncSummary} from './syncState';

export type CloudState='local'|'pending'|'remote'|'synced'|'conflict'|'excluded';
export const cloudLabels:Record<CloudState,string>={local:'未同步',pending:'待同步',remote:'云端有更新',synced:'已同步',conflict:'需处理',excluded:'已排除'};
export function useMobileCloud(root:string,tree:FileNode[],documents:Record<string,OpenDocument>,enabled:boolean){
  const [revision,setRevision]=useState(0),[value,setValue]=useState<{configured:boolean;loading:boolean;summary:SyncSummary;files:Record<string,CloudState>;error:string}>({configured:false,loading:false,summary:emptySummary(),files:{},error:''});
  const [operation,setOperation]=useState(currentSyncOperation);
  useEffect(()=>{const update=()=>setOperation(currentSyncOperation());window.addEventListener('moyu-mobile-sync-progress',update);return()=>window.removeEventListener('moyu-mobile-sync-progress',update);},[]);
  useEffect(()=>{const update=()=>setRevision(value=>value+1);window.addEventListener('moyu-mobile-sync-changed',update);return()=>window.removeEventListener('moyu-mobile-sync-changed',update);},[]);
  useEffect(()=>{
    if(!enabled||!root)return;let alive=true;
    void(async()=>{
      const config=await mobileFeature<SyncConfig>('mobile.webdav-config',{root});if(!alive)return;
      if(!config.url){setValue({configured:false,loading:false,summary:emptySummary(),files:{},error:''});return;}
      const key=await syncKey(root,config),summary=readSummary(key),baseline=readBaseline(key),settings=policy(config.sync),excluded=excludedBy(settings);
      setValue(value=>({...value,configured:true,loading:true,summary,error:''}));
      const files=flatten(tree),eligible=files.filter(file=>syncEligible(file.path)&&!excluded(file.path)&&(file.size||0)<=settings.maxFileMB*1024*1024);
      const hashes=await mobileFeature<Record<string,string>>('mobile.file-hashes',{root,paths:eligible.map(file=>file.path)});if(!alive)return;
      const statuses:Record<string,CloudState>=Object.create(null),conflicts=new Set(summary.conflicts),cloud=new Map(summary.remote.filter(file=>file.type!=='folder').map(file=>[file.path,file]));
      for(const file of files){const path=file.path,base=baseline[path],remote=cloud.get(path);
        statuses[path]=!Object.hasOwn(hashes,path)?'excluded':conflicts.has(path)?'conflict':!base?'local':hashes[path]!==base.localHash?'pending':summary.checkedAt&&(!remote||remote.etag&&!sameToken(remote.etag,base.remoteEtag))?'remote':'synced';
      }
      const rank:Record<CloudState,number>={excluded:0,synced:1,local:2,remote:3,pending:4,conflict:5};
      const folders=(nodes:FileNode[]):CloudState=>{let worst:CloudState='excluded';for(const node of nodes){const state=node.kind==='folder'?folders(node.children||[]):statuses[node.path]||'excluded';if(node.kind==='folder')statuses[node.path]=state;if(rank[state]>rank[worst])worst=state;}return worst;};folders(tree);
      setValue({configured:true,loading:false,summary,files:statuses,error:''});
    })().catch(error=>{if(alive)setValue(value=>({...value,loading:false,error:(error as Error).message}));});
    return()=>{alive=false;};
  },[root,tree,revision,enabled]);
  const files={...value.files};for(const doc of Object.values(documents))if(doc.dirty&&files[doc.path]!=='excluded')files[doc.path]='pending';
  return {...value,files,operation:operation?.root===root?operation:null};
}
