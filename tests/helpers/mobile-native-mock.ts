import type { Page } from '@playwright/test';

/** Storage boundary only: all editor, navigation, reference and save code is real. */
export async function mockAndroid(page:Page,initial?:{files:Record<string,{content:string;base64?:string;updated?:number}>;folders?:string[]}) {
  await page.addInitScript((initial)=>{
    Object.defineProperty(window,'queryLocalFonts',{value:undefined,configurable:true});
    const original=localStorage.getItem('moyu-android-test');
    const state=original?JSON.parse(original):{files:{'开始使用.md':{content:'# 开始使用\n\n普通文字，可以在手机上编辑。\n\n> [+] 折叠内容\n> 这是一段可收起的文字。\n\n```javascript\nconsole.log(42);\n```\n',updated:Date.now()},'读书笔记/第一章.md':{content:'# 第一章\n\n重要内容。',updated:Date.now()}},folders:['读书笔记'],settings:{},drafts:{},history:{},trash:[],root:'internal'};
    if(!original&&initial){state.files=initial.files;state.folders=initial.folders||[];}
    const persist=()=>localStorage.setItem('moyu-android-test',JSON.stringify(state));
    (window as any).__mobileState=state;
    const calls:Record<string,number>={};(window as any).__mobileCalls=calls;
    state.keyboardVisible=false;
    const keyboard=(visible:boolean)=>{state.keyboardVisible=visible;window.dispatchEvent(new CustomEvent('moyu-mobile-keyboard',{detail:visible}));};
    const typing=()=>!!document.activeElement?.closest('.ProseMirror,.cm-content,textarea,input:not([type=range]):not([type=checkbox])');
    document.addEventListener('focusin',()=>{if(typing())keyboard(true);});
    document.addEventListener('focusout',()=>queueMicrotask(()=>{if(!typing())keyboard(false);}));
    const bytes=(value:any)=>value.base64?Uint8Array.from(atob(value.base64),c=>c.charCodeAt(0)):new TextEncoder().encode(value.content);
    const hash=async(content:string|Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof content==='string'?new TextEncoder().encode(content):content))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const read=async(path:string)=>{const value=state.files[path];if(!value)throw Error('文件不存在。');return{path,...value,version:await hash(bytes(value))};};
    const list=()=>{
      const tree:any[]=[];
      const add=(path:string,kind:string)=>{let nodes=tree;path.split('/').forEach((name,index,parts)=>{const relative=parts.slice(0,index+1).join('/');let node=nodes.find(node=>node.path===relative);if(!node){node={path:relative,name,kind:index===parts.length-1?kind:'folder',children:[],updated:state.files[relative]?.updated,size:state.files[relative]?bytes(state.files[relative]).length:0};nodes.push(node);}nodes=node.children;});};
      state.folders.forEach((path:string)=>add(path,'folder'));Object.keys(state.files).forEach(path=>add(path,'file'));
      const sort=(nodes:any[])=>{nodes.sort((a,b)=>a.kind===b.kind?a.name.localeCompare(b.name,'zh-CN'):a.kind==='folder'?-1:1);nodes.forEach(node=>sort(node.children));};sort(tree);
      return{root:state.root,name:state.vaultName||'我的知识库',tree};
    };
    const feature=async(action:string,input:any={})=>{
      input ||= {};
      if(action.startsWith('mobile.')&&input.root&&input.root!==state.root)throw Error('知识库已切换。');
      if(action==='preferences.get')return state.settings;
      if(action==='preferences.set-many'){Object.assign(state.settings,input.values);persist();return true;}
      if(action==='code.counter')return{next:1};if(action==='code.normalize')return{};
      if(action==='mobile.theme'){state.systemBars=input;return true;}if(action==='mobile.finish')return true;
      if(action==='mobile.keyboard-visible')return !!state.keyboardVisible;
      if(action==='mobile.copy-text'||action==='clipboard.write'){state.clipboard=input.text;return true;}
      if(action==='mobile.share-files'){state.sharedFiles=input.paths;return true;}
      if(action==='mobile.file-location')return '/data/user/0/app.moyu.notes/files/vault/'+input.path;
      if(action==='mobile.update-request'){(state.updateRequests||=[]).push(input);if(state.updateFailure)throw Error('无法连接 GitHub，请稍后重试。');return state.updateResponses?.[input.kind]||{status:200,body:JSON.stringify(state.updateRelease||{tag_name:'v0.0.0',draft:false,prerelease:false,assets:[]})};}
      if(action==='mobile.drafts')return Object.values(state.drafts);
      if(action==='mobile.draft'){state.drafts[input.path]=input;persist();return true;}
      if(action==='mobile.draft-clear'){delete state.drafts[input.path];persist();return true;}
      if(action==='file.exists')return !!state.files[input.path]||state.folders.includes(input.path)||Object.keys(state.files).some(path=>path.startsWith(input.path+'/'));
      if(action==='drawing.read')return read(input.path);
      if(action==='drawing.save')return invoke('save',[input.path,input.content,input.version]);
      if(action==='file.binary-read'){const value=await read(input.path);return{...value,content:''};}
      if(action==='file.history-list')return{entries:state.history[input.document]||[],enabled:true};
      if(action==='file.history-read'||action==='file.history-restore'){const item=(state.history[input.document]||[]).find((item:any)=>item.id===input.id);return{content:item.content};}
      if(action==='file.history-capture'){(state.history[input.document]||=[]).unshift({id:String(Date.now()),time:Date.now(),content:input.content});persist();return true;}
      if(action==='mobile.trash-list')return state.trash;
      if(action==='mobile.trash-restore'){const item=state.trash.find((item:any)=>item.id===input.id);if(state.files[item.path])throw Error('原位置已有同名文件。');Object.assign(state.files,item.files);state.trash=state.trash.filter((value:any)=>value!==item);persist();return list();}
      if(action==='mobile.relocate'){
        for(const move of input.moves){if(state.files[move.to]||state.folders.includes(move.to))throw Error('目标名称已经存在。');}
        const remap=(path:string)=>{const move=input.moves.find((move:any)=>path===move.from||path.startsWith(move.from+'/'));return move?move.to+path.slice(move.from.length):path;};
        state.files=Object.fromEntries(Object.entries(state.files).map(([path,value])=>[remap(path),value]));state.folders=state.folders.map(remap);
        for(const edit of input.edits)state.files[edit.path]={content:edit.content,updated:Date.now()};persist();return{moves:input.moves,documents:await Promise.all(input.edits.map((edit:any)=>read(edit.path)))};
      }
      if(action==='mobile.internal-vault'){state.root='internal';persist();return list();}
      if(action==='mobile.pick-attachment'){if(state.cancelAttachment)return[];const path=input.document.replace(/\.md$/,'.assets')+'/attachments/图片.svg';state.files[path]={content:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="blue"/></svg>',updated:Date.now()};persist();return[{path,name:'图片.svg'}];}
      if(action==='mobile.webdav-config'){state.davConnections||={};if(input.config){state.davConnections[state.root]=input.config;persist();return true;}return state.davConnections[state.root]||{};}
      if(action==='mobile.webdav-request')return (window as any).__mobileDav(input);
      if(action==='mobile.webdav-cancel')return (window as any).__mobileDavCancel(input);
      if(action==='mobile.write-bytes'){
        if(input.expected){if((await read(input.path)).version!==input.expected)throw Error('文件已改变。');}else if(state.files[input.path])throw Error('文件已存在。');
        const raw=Uint8Array.from(atob(input.base64),c=>c.charCodeAt(0));state.files[input.path]={content:new TextDecoder().decode(raw),base64:input.base64,updated:state.fixedModified??Date.now()};persist();return hash(raw);
      }
      if(action==='mobile.read-bytes'){const file=await read(input.path);return{base64:state.files[input.path].base64||btoa(unescape(encodeURIComponent(state.files[input.path].content))),hash:file.version,size:bytes(state.files[input.path]).length};}
      if(action==='mobile.file-hashes'){const result:any={};for(const path of input.paths)if(state.files[path])result[path]=(await read(path)).version;return result;}
      if(action==='mobile.sync-delete'){if((await read(input.path)).version!==input.expected)throw Error('文件已改变。');return invoke('trash',[input.path]);}
      if(action==='mobile.share'||action==='mobile.open-file')return true;
      if(action==='mobile.import-files')return [];
      throw Error('Unmocked native action: '+action);
    };
    const invoke=async(method:string,args:any[])=>{
      if(method==='load'||method==='list')return list();if(method==='read')return read(args[0]);
      if(method==='feature')return feature(args[0],args[1]);
      if(method==='save'){const current=await read(args[0]);if(current.version!==args[2])throw Object.assign(Error('文件已被其他应用修改。'),{code:'CONFLICT',current});(state.history[args[0]]||=[]).unshift({id:String(Date.now()),time:Date.now(),content:current.content});state.files[args[0]]={content:args[1],updated:Date.now()};delete state.drafts[args[0]];persist();return read(args[0]);}
      if(method==='create'){if(state.files[args[0]]||state.folders.includes(args[0]))throw Error('这个名称已经存在。');if(args[1]==='folder')state.folders.push(args[0]);else state.files[args[0]]={content:args[2]||'',updated:Date.now()};persist();return args[1]==='folder'?{path:args[0],content:'',version:'',updated:Date.now()}:read(args[0]);}
      if(method==='search')return Object.entries(state.files).flatMap(([path,value]:any)=>{const matches=value.content.split('\n').flatMap((text:string,index:number)=>text.includes(args[0])?[{text,line:index+1}]:[]).slice(0,5);return path.includes(args[0])||matches.length?[{path,name:path.split('/').pop(),matches}]:[];});
      if(method==='trash'){const removed=Object.fromEntries(Object.entries(state.files).filter(([path])=>path===args[0]||path.startsWith(args[0]+'/')));state.trash.push({id:String(Date.now()),path:args[0],time:Date.now(),files:removed});for(const path of Object.keys(removed))delete state.files[path];state.folders=state.folders.filter((path:string)=>path!==args[0]&&!path.startsWith(args[0]+'/'));persist();return list();}
      if(method==='openExternal'){state.openedURL=args[0];return true;}if(method==='exportFile'||method==='exportPDF')return true;
      if(method==='importFiles')return[];if(method==='openVault')return null;
      throw Error('Unmocked native method: '+method);
    };
    window.MoyuNative={onmessage:null,postMessage(message:string){const request=JSON.parse(message),key=request.method==='feature'?request.args[0]:request.method;calls[key]=(calls[key]||0)+1;void invoke(request.method,request.args).then(data=>window.MoyuNative!.onmessage?.({data:JSON.stringify({id:request.id,ok:true,data})} as MessageEvent<string>)).catch(error=>window.MoyuNative!.onmessage?.({data:JSON.stringify({id:request.id,ok:false,error:{message:error.message,code:error.code,current:error.current}})} as MessageEvent<string>));}};
  },initial||null);
  await page.route('https://appassets.androidplatform.net/vault/**',async route=>{
    const path=decodeURIComponent(new URL(route.request().url()).pathname.slice(7));
    const content=await page.evaluate(path=>(window as any).__mobileState.files[path]?.content||'',path);
    await route.fulfill({contentType:'image/svg+xml',body:content,headers:{'Access-Control-Allow-Origin':'*'}});
  });
}
