import {releaseInfo,releases,releaseAssets,stableReleaseVersion,newerRelease,type ReleaseInfo} from '../../shared/app-releases.mjs';
import {settingsStore} from '../settingsStore';
import {mobileFeature} from './native';
import build from '../../shared/mobile-build.json';
type Response={status:number;body?:string;location?:string;size?:number};
export type MobileUpdateState={current:string;canAutoCheck:boolean;automatic:boolean;checkedAt:number;attemptedAt:number;latest:ReleaseInfo|null};
const DAY=86400000,key='moyu-mobile-updates';
export class MobileUpdates {
  private pending:Promise<MobileUpdateState>|null=null;
  constructor(private request=(input:{kind:string;url?:string})=>mobileFeature<Response>('mobile.update-request',input),readonly version=build.version,private now=Date.now){}
  state():MobileUpdateState {
    let saved:any={};try{saved=JSON.parse(settingsStore.getItem(key)||'{}');}catch{/* Start with defaults if preferences are damaged. */}
    let latest:ReleaseInfo|null=null;
    if(saved?.latest)try{const value=saved.latest,tag='v'+value.version,info=releaseInfo({tag_name:tag,assets:[{name:releaseAssets(value.version,'android')[0],state:'uploaded',size:1,browser_download_url:value.downloadUrl}]},'android','universal');if(newerRelease(info.version,this.version)&&value.url===info.url)latest=info;}catch{/* Never open unvalidated cached URLs. */}
    return{current:this.version,canAutoCheck:true,automatic:saved?.automatic!==false,checkedAt:Number.isFinite(saved?.checkedAt)?saved.checkedAt:0,attemptedAt:Number.isFinite(saved?.attemptedAt)?saved.attemptedAt:0,latest};
  }
  private async save(patch:Partial<MobileUpdateState>){const{current,canAutoCheck,...saved}=this.state();settingsStore.setItem(key,JSON.stringify({...saved,...patch}));await settingsStore.flush();return this.state();}
  configure(automatic:boolean){if(typeof automatic!=='boolean')throw Error('更新设置无效。');return this.save({automatic});}
  async check(manual=false):Promise<MobileUpdateState>{
    if(this.pending)return this.pending;
    const saved=this.state(),elapsed=this.now()-Math.max(saved.checkedAt,saved.attemptedAt);
    if(!manual&&(!saved.automatic||elapsed>=0&&elapsed<DAY))return saved;
    const task=(async()=>{
      await this.save({attemptedAt:this.now()});let response:Response|null=null,latest:ReleaseInfo;
      try{response=await this.request({kind:'latest'});}catch{/* GitHub's release redirect also works when its public API is limited. */}
      if(response?.status===200){let metadata:unknown;try{metadata=JSON.parse(response.body||'');}catch{throw Error('无法读取 GitHub 版本信息。');}latest=releaseInfo(metadata,'android','universal',this.version);}
      else if(!response||[403,429].includes(response.status)){
        const redirect=await this.request({kind:'redirect'}),url=new URL(redirect.location||'',releases+'/latest'),prefix='/JJl624/Moyu/releases/tag/',tag=decodeURIComponent(url.pathname.slice(prefix.length)),version=stableReleaseVersion(tag);
        if(![301,302,303,307,308].includes(redirect.status)||url.origin!=='https://github.com'||!url.pathname.startsWith(prefix)||url.search||url.hash||!version)throw Error('无法读取 GitHub 版本信息。');
        latest={version,url:releases+'/tag/'+encodeURIComponent(tag)};
        if(newerRelease(version,this.version)){const name=releaseAssets(version,'android')[0],downloadUrl=releases+'/download/'+encodeURIComponent(tag)+'/'+name,asset=await this.request({kind:'asset',url:downloadUrl});if(asset.status!==200||!(Number(asset.size)>0))throw Error('新版 Android 安装包尚未就绪。');latest.downloadUrl=downloadUrl;}
      }else throw Error(response.status===404?'暂时没有正式发布的版本。':'检查更新失败（HTTP '+response.status+'）。');
      return this.save({checkedAt:this.now(),latest:newerRelease(latest.version,this.version)?latest:null});
    })();this.pending=task;
    try{return await task;}finally{if(this.pending===task)this.pending=null;}
  }
}
export const mobileUpdates=new MobileUpdates();
