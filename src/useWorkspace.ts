import {idFloor,reserveIds,setCodeNamespace} from './codeIds';
import {setAttachmentScope} from './attachments/preferences';
import {flushAttachmentViews,reloadAttachmentViews} from './attachments/viewState';
import {fileKind} from './fileKinds';
import { settingsStore } from './settingsStore';
import {settleHTMLResults} from './htmlResultLifecycle';
import { createCloseQueue } from './documents/closeQueue';
import { DocumentLifetimes } from '../shared/document-lifetimes.mjs';
import {visitDocument} from '../shared/document-stack.mjs';
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./bridge";
import {
  flatten,
  type OpenDocument,
  type Workspace,
  type DiskDocument,
} from "./types";
const isDrawing=(path:string)=>/\.excalidraw$/i.test(path);
const readDocument=async(path:string)=>{const document=['image','pdf','score','sqlite'].includes(fileKind(path))?await api.feature<DiskDocument>('file.binary-read',{path}):isDrawing(path)?await api.feature<DiskDocument>('drawing.read',{path}):await api.read(path);if(api.desktop&&api.platform!=='android'&&/\.(md|markdown)$/i.test(path)){const counter=await api.feature<{next:number}>('code.counter',{document:path});reserveIds(undefined,path,counter.next);}return document;};
const initialMarkdown=(files:{path:string}[])=>files.find(f=>f.path==='markdown完全语法示例.md') ?? files.find(f=>f.path==='开始使用.md') ?? files.find(f=>/\.(md|markdown)$/i.test(f.path));
export type SavePolicy='manual'|'close'|'realtime';

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const inventory=useRef<Workspace|null>(null);if(workspace)inventory.current=workspace;
  const [documents, setDocuments] = useState<Record<string, OpenDocument>>({});
  const docs = useRef(documents);
  const [tabs, setTabs] = useState<string[]>([]);
  const [previewTab,setPreviewTab]=useState('');
  const currentPreview=useRef('');currentPreview.current=previewTab;
  const [active, setActive] = useState("");
  const currentTabs=useRef(tabs),currentActive=useRef(active),generation=useRef(0),openTicket=useRef(0),currentRoot=useRef(workspace?.root);
  currentTabs.current=tabs;currentActive.current=active;
  currentRoot.current=workspace?.root;
  if(workspace){setCodeNamespace(workspace.root);setAttachmentScope(workspace.root);}
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [savePolicy,setSavePolicy]=useState<SavePolicy>(()=>{
    const value=settingsStore.getItem('moyu-save-policy');return value==='manual'||value==='close'||value==='realtime'?value:settingsStore.getItem('moyu-autosave')==='false'?'manual':'realtime';
  });
  const [saveDelay,setSaveDelay]=useState(()=>Math.max(200,Math.min(10000,Number(settingsStore.getItem('moyu-save-delay'))||900)));
  const policyRef=useRef(savePolicy);policyRef.current=savePolicy;
  const saveRef=useRef<(path:string)=>Promise<boolean>>(async()=>true);
  const renaming=useRef(false),closingQueue=useRef<ReturnType<typeof createCloseQueue>|null>(null);
  closingQueue.current ??= createCloseQueue();
  const pending = useRef(new Map<string, Promise<boolean>>());
  const normalized=useRef(new Map<string,{content:string;floor:number}>());
  const lifetimes = useRef(new DocumentLifetimes());
  const commit = useCallback((next: Record<string, OpenDocument>) => {
    docs.current = next;
    setDocuments(next);
  }, []);
  const update = useCallback(
    (path: string, patch: Partial<OpenDocument>) => {
      const current = docs.current[path];
      if (current)
        commit({ ...docs.current, [path]: { ...current, ...patch } });
    },
    [commit],
  );
  const pin=useCallback((path:string)=>{if(currentPreview.current===path){currentPreview.current='';setPreviewTab('');}},[]);
  const discardTab=useCallback((path:string)=>{
    lifetimes.current.close(path);
    pin(path);
    const existing=currentTabs.current,next=existing.filter(tab=>tab!==path);
    currentTabs.current=next;setTabs(next);
    if(currentActive.current===path){
      currentActive.current=api.platform==='android'?next.at(-1)||'':next[Math.max(0,existing.indexOf(path)-1)]||'';
      setActive(currentActive.current);
    }
    const remaining={...docs.current};delete remaining[path];commit(remaining);
  },[commit,pin]);
  // Recover buffers in the background without visiting documents or saving the
  // previously active buffer. Their asynchronous work needs a lifetime too.
  const restoreDraft=useCallback((root:string,disk:DiskDocument,content:string,version:string)=>{
    if(currentRoot.current!==root||docs.current[disk.path]?.dirty)return false;
    if(!docs.current[disk.path])lifetimes.current.open(disk.path);
    pin(disk.path);
    commit({...docs.current,[disk.path]:{...disk,content,savedContent:disk.content,version,dirty:content!==disk.content,saving:false,conflict:disk.version===version?undefined:disk}});
    if(!currentTabs.current.includes(disk.path)){const next=[disk.path,...currentTabs.current];currentTabs.current=next;setTabs(next);}
    return true;
  },[commit,pin]);
  const open = useCallback(
    async (path: string,preview=false) => {
      const request=generation.current,ticket=++openTicket.current;
      try {
        const previous=currentActive.current;
        if(previous && previous!==path && policyRef.current!=='manual' && (docs.current[previous]?.dirty||pending.current.has(previous)) && !(await saveRef.current(previous)))return false;
        if(request!==generation.current||ticket!==openTicket.current)return false;
        if (!docs.current[path]) {
          const document = await readDocument(path);
          if(request!==generation.current||ticket!==openTicket.current)return false;
          const content=document.content;
          if(!docs.current[path]){lifetimes.current.open(path);commit({
            ...docs.current,
            [path]: {
              ...document,
              content,
              savedContent: document.content,
              dirty: content!==(document.content),
              saving: false,
            },
          });}
        }
        if(request!==generation.current||ticket!==openTicket.current)return false;
        if(currentActive.current && currentActive.current!==path)await settleHTMLResults({documents:[currentActive.current],stop:true});
        if(request!==generation.current||ticket!==openTicket.current)return false;
        let next=currentTabs.current;
        const old=currentPreview.current;
        if(!preview||docs.current[path]?.dirty)pin(path);
        else if(!next.includes(path)){
          const disposable=old&&old!==path&&!docs.current[old]?.dirty&&!docs.current[old]?.saving&&!docs.current[old]?.conflict&&!docs.current[old]?.error;
          if(disposable){next=currentActive.current===old?next.map(tab=>tab===old?path:tab):next.filter(tab=>tab!==old);lifetimes.current.close(old);const remaining={...docs.current};delete remaining[old];commit(remaining);}
          currentPreview.current=path;setPreviewTab(path);
        }
        if(api.platform==='android')next=visitDocument(next,path);
        else if(!next.includes(path)){
          const index=next.indexOf(currentActive.current), at=index<0?next.length:index+1;
          next=[...next.slice(0,at),path,...next.slice(at)];
        }
        currentTabs.current=next;setTabs(next);
        currentActive.current=path;setActive(path);return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      }
    },
    [commit,pin],
  );
  const save = useCallback(
    async (path: string): Promise<boolean> => {
      const request = generation.current, token = lifetimes.current.token(path), root = currentRoot.current;
      const owns = () => request === generation.current && lifetimes.current.owns(path, token);
      pin(path);
      if (pending.current.has(path)) {
        await pending.current.get(path);
        if (!owns()) return false;
        const latest = docs.current[path];
        if (latest?.conflict || latest?.error) return false;
        if (latest?.dirty) return save(path);
        return true;
      }
      const doc = docs.current[path];
      if (!doc?.dirty) return true;
      if(renaming.current)return false;
      if (doc.conflict) return false;
      update(path, { saving: true, error: undefined });
      const task: Promise<boolean> = Promise.resolve().then(async () => {
        try {
          const saved = isDrawing(path)?await api.feature<DiskDocument>('drawing.save',{root,path,content:doc.content,version:doc.version}):await api.save(path, doc.content, doc.version, root);
          if (!owns()) return false;
          const latest = docs.current[path];
          if (saved.historyWarning) setError(saved.historyWarning);
          if (latest)
            update(path, {
              version: saved.version,
              updated: saved.updated,
              savedContent: doc.content,
              dirty: latest.content !== doc.content,
              saving: false,
              error: undefined,
            });
          return true;
        } catch (err) {
          if (!owns()) return false;
          const failure = err as Error & {
            code?: string;
            current?: DiskDocument;
          };
          update(path, {
            saving: false,
            error: failure.message,
            conflict: failure.code === "CONFLICT" ? failure.current : undefined,
          });
          setError(failure.message);
          return false;
        } finally {
          if (pending.current.get(path) === task) pending.current.delete(path);
        }
      });
      pending.current.set(path, task);
      return task;
    },
    [update,pin],
  );
  const saveAll = useCallback(async () => {
    await flushAttachmentViews();
    await settleHTMLResults();
    // A write can finish while new typing is already dirty. Drain until every
    // latest snapshot is saved before closing a tab or changing workspaces.
    while (Object.values(docs.current).some((doc) => doc.dirty || doc.saving)) {
      const results = await Promise.all(Object.keys(docs.current).map(save));
      if (!results.every(Boolean)) return false;
    }
    return true;
  }, [save]);
  saveRef.current=save;
  const change = useCallback(
    (path: string, content: string) => {
      if(inventory.current?.readOnly)return;
      const document = docs.current[path];
      if (!['markdown','drawing','html','text'].includes(fileKind(path))) return;
      if (!document || content === document.content) return;
      pin(path);
      update(path, {
        content,
        dirty: content !== document.savedContent,
        error: undefined,
      });
    },
    [update,pin],
  );
  useEffect(()=>{
    if(!api.desktop||api.platform==='android')return;
    for(const name of normalized.current.keys())if(!docs.current[name]?.dirty)normalized.current.delete(name);
    if(!Object.values(documents).some(doc=>doc.dirty&&/\.(md|markdown)$/i.test(doc.path)))return;
    const timer=setTimeout(()=>{for(const doc of Object.values(docs.current))if(doc.dirty&&/\.(md|markdown)$/i.test(doc.path)){
      const floor=idFloor(undefined,doc.path),old=normalized.current.get(doc.path);if(old?.content===doc.content&&old.floor===floor)continue;
      const value={content:doc.content,floor};normalized.current.set(doc.path,value);
      void api.feature('code.normalize',{root:currentRoot.current,document:doc.path,content:doc.content,next:floor}).catch(e=>{if(normalized.current.get(doc.path)===value)normalized.current.delete(doc.path);setError(e.message);});
    }},750);return()=>clearTimeout(timer);
  },[documents]);
  useEffect(()=>api.onScanError?.(setError),[]);
  const refresh = useCallback(async () => {const request=generation.current,state=await api.list();if(request===generation.current&&state.root===currentRoot.current)setWorkspace(state);}, []);
  const replaceWorkspace = useCallback(
    async (state: Workspace) => {
      generation.current++;
      normalized.current.clear();
      lifetimes.current.clear();
      openTicket.current++;
      currentTabs.current=[];currentActive.current='';currentPreview.current='';setPreviewTab('');
      currentRoot.current=state.root;setCodeNamespace(state.root);
      commit({});
      setTabs([]);
      setActive("");
      setWorkspace(state);
      inventory.current=state;
      if(state.warnings?.length)setError(state.warnings.join('\n'));
      const first =
        initialMarkdown(flatten(state.tree));
      if (first) await open(first.path);
    },
    [commit, open],
  );
  const leaveWorkspace = () => {
    generation.current++;openTicket.current++;currentRoot.current=undefined;
    normalized.current.clear();
    lifetimes.current.clear();
    currentTabs.current=[];currentActive.current='';currentPreview.current='';
    commit({});setTabs([]);setActive('');setPreviewTab('');setWorkspace(null);inventory.current=null;setError('');
  };
  useEffect(() => {
    let disposed = false;
    api
      .load()
      .then(async (state) => {
        if (disposed) return;
        setWorkspace(state);
        inventory.current=state;if(state)setCodeNamespace(state.root);
        if(state?.warnings?.length)setError(state.warnings.join('\n'));
        if (!state) { setReady(true); return; }
        let session: { tabs: string[]; active: string } | null = null;
        try {
          session = JSON.parse(
            settingsStore.getItem("moyu-session-" + state.root) ?? "null",
          );
        } catch {}
        const files = flatten(state.tree).filter((file) =>
          file.kind === 'file',
        );
        const restored =
          session?.tabs.filter((path) =>
            files.some((file) => file.path === path),
          ) ?? [];
        if (restored.length) {
          for (const path of restored) await open(path);
          if (session?.active && restored.includes(session.active)){
            if(api.platform==='android')await open(session.active);else setActive(session.active);
          }
        } else {
          const first =
            initialMarkdown(files) ?? files[0];
          if (first) await open(first.path);
        }
        setReady(true);
      })
      .catch((err) => {
        setError(err.message);
        setReady(true);
      });
    return () => {
      disposed = true;
    };
  }, [open]);
  useEffect(() => {
    if (workspace && ready)
      settingsStore.setItem(
        "moyu-session-" + workspace.root,
        JSON.stringify({ tabs:tabs.filter(path=>path!==previewTab), active:active===previewTab?tabs.filter(path=>path!==previewTab).at(-1)||'':active }),
      );
  }, [workspace?.root, tabs, active, previewTab, ready]);
  useEffect(() => {
    settingsStore.setItem('moyu-save-policy',savePolicy);
    if (savePolicy!=='realtime'||!Object.values(documents).some(doc=>doc.dirty&&!doc.saving&&!doc.conflict&&!doc.error)) return;
    const timer = window.setTimeout(() => {
      Object.values(docs.current)
        .filter((doc) => doc.dirty && !doc.conflict && !doc.error)
        .forEach((doc) => void save(doc.path));
    }, saveDelay);
    return () => window.clearTimeout(timer);
  }, [documents, savePolicy, save, saveDelay]);
  useEffect(()=>{settingsStore.setItem('moyu-save-delay',String(saveDelay));},[saveDelay]);
  useEffect(
    () =>
      api.onChange(async (state) => {
        if(state.root!==currentRoot.current)return;
        setWorkspace(state);
        if(state.warnings?.length)setError(state.warnings.join('\n'));
        const files = flatten(state.tree);
        for (const document of Object.values(docs.current)) {
          const file = files.find((file) => file.path === document.path);
          if (!file && !document.dirty && !document.saving) {
            // Watcher scans can predate a newly created/opened file. Confirm
            // disk deletion before discarding a clean tab, and recheck state
            // after I/O so edits, reopening and workspace changes win.
            let exists = true;
            try {
              exists = api.desktop
                ? await api.feature<boolean>('file.exists', { path: document.path })
                : await api.read(document.path).then(() => true, () => false);
            } catch { continue; }
            if (state.root !== currentRoot.current) return;
            const latest = docs.current[document.path];
            if (exists || latest !== document || latest.dirty || latest.saving) continue;
            discardTab(document.path);
            continue;
          }
          if (
            file &&
            (file.updated !== document.updated||state.changedPaths?.includes(document.path)) &&
            !document.dirty &&
            !document.saving
          ) {
            try {
              const disk = await readDocument(document.path);
              if(state.root!==currentRoot.current)return;
              // Do not replace text if the user started typing while disk I/O was pending.
              const latest = docs.current[document.path];
              if (
                latest &&
                latest.version===document.version &&
                !latest.dirty &&
                !latest.saving &&
                (disk.content !== latest.content || disk.updated!==latest.updated||disk.version!==latest.version)
              ) {
                const content=disk.content;
                update(document.path, { ...disk,content,savedContent: disk.content,dirty:content!==disk.content });
                if(document.path===active&&disk.content!==latest.content)setEditorEpoch((epoch) => epoch + 1);
              }
            } catch {}
          }
        }
      }),
    [update,active,discardTab],
  );
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!api.desktop&&Object.values(docs.current).some((doc) => doc.dirty)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  const prepareClose=(paths=Object.keys(docs.current))=>{
    const request=generation.current;
    return closingQueue.current!(async()=>{
      if(request!==generation.current)return false;
      await flushAttachmentViews();
      await settleHTMLResults({documents:paths});
      await Promise.all(paths.map(path=>pending.current.get(path)));
      if(request!==generation.current)return false;
      if(api.desktop&&api.platform!=='android')for(const path of paths){const doc=docs.current[path];if(doc?.dirty&&/\.(md|markdown)$/i.test(path))await api.feature('code.normalize',{root:currentRoot.current,document:path,content:doc.content,next:idFloor(undefined,path)});if(request!==generation.current)return false;}
      const dirty=paths.filter(path=>docs.current[path]?.dirty);
      if(!dirty.length){await settleHTMLResults({documents:paths,stop:true});return true;}
      let choice='save';
      if(policyRef.current==='manual')choice=api.desktop?await api.feature<string>('document.confirm-close',{paths:dirty}):window.confirm('文档未保存，保存后关闭？')?'save':'cancel';
      if(request!==generation.current)return false;
      if(choice==='cancel')return false;if(choice==='discard'){await settleHTMLResults({documents:paths,stop:true});return true;}
      for(const path of dirty)do{if(!(await save(path)))return false;}while(docs.current[path]?.dirty);
      await settleHTMLResults({documents:paths,stop:true});return true;
    });
  };
  const closeTab = async (path: string,prepared=false) => {
    const request=generation.current;
    if(!prepared&&!(await prepareClose([path])))return false;
    if(request!==generation.current)return false;
    discardTab(path);
    return true;
  };
  const closeTabs=async(paths:string[])=>{if(!(await prepareClose(paths)))return false;for(const path of paths)if(!(await closeTab(path,true)))return false;return true;};
  const applyFiles=(result:{documents:DiskDocument[];buffers:{original:string;path:string;content:string}[]})=>{
    const previous=docs.current[currentActive.current]?.content;
    const next=Object.fromEntries(Object.entries(docs.current).map(([path,doc])=>{const disk=result.documents.find(d=>d.path===path),buffer=result.buffers.find(b=>b.original===path),content=buffer?.content??disk?.content??doc.content;return[path,{...doc,...disk,content,savedContent:disk?.content??doc.savedContent,dirty:content!==(disk?.content??doc.savedContent)}];}));
    commit(next);
    if(next[currentActive.current]?.content!==previous)setEditorEpoch(epoch=>epoch+1);
  };
  const copy=async(from:string,to:string)=>{const root=currentRoot.current;await flushAttachmentViews();await Promise.all(pending.current.values());if(root!==currentRoot.current)throw new Error('知识库已切换。');renaming.current=true;try{await api.feature('file.copy',{root,from,to,buffers:Object.values(docs.current).filter(d=>/\.(md|markdown)$/i.test(d.path)).map(d=>({path:d.path,content:d.content,version:d.version}))});await refresh();return true;}finally{renaming.current=false;}};
  const rename = async (from: string, to: string) => {
    const root=currentRoot.current;
    await flushAttachmentViews();
    await Promise.all(pending.current.values());renaming.current=true;
    try{
    if(root!==currentRoot.current)throw new Error('知识库已切换。');
    const result=api.desktop?await api.feature<{moves?:{from:string;to:string}[];documents:DiskDocument[];buffers:{original:string;path:string;content:string}[]}>('attachment.rename',{root,from,to,buffers:Object.values(docs.current).filter(d=>/\.(md|markdown)$/i.test(d.path)).map(d=>({path:d.path,content:d.content,version:d.version}))}):(await api.rename(from,to),{documents:[],buffers:[]});
    await reloadAttachmentViews(result.documents.map(document=>document.path));
    const remap=(path:string)=>{const move=(result.moves||[{from,to}]).find(m=>path===m.from||path.startsWith(m.from+'/'));return move?move.to+path.slice(move.from.length):path;};
    lifetimes.current.rename(remap);
    commit(
      Object.fromEntries(
        Object.entries(docs.current).map(([path, doc]) => [
          remap(path),
          (()=>{const disk=result.documents.find(d=>d.path===remap(path)),buffer=result.buffers.find(b=>b.original===path),content=buffer?.content??doc.content;return {...doc,...disk,path:remap(path),content,savedContent:disk?.content??doc.savedContent,dirty:content!==(disk?.content??doc.savedContent)};})(),
        ]),
      ),
    );
    setTabs((previous) => previous.map(remap));
    setActive((previous) => remap(previous));
    currentTabs.current=currentTabs.current.map(remap);currentActive.current=remap(currentActive.current);currentPreview.current=remap(currentPreview.current);setPreviewTab(currentPreview.current);
    setEditorEpoch(epoch=>epoch+1);
    await refresh();
    return true;
    }finally{renaming.current=false;}
  };
  const resolveConflict = async (path: string, action: "disk" | "mine") => {
    const doc = docs.current[path];
    if (!doc?.conflict) return;
    const token = lifetimes.current.token(path);
    const disk = await readDocument(path);
    const latest = docs.current[path];
    if (!lifetimes.current.owns(path, token) || latest?.content !== doc.content || latest?.version !== doc.version)
      throw Error('文档内容已改变，请重新处理冲突。');
    if (action === "disk") {
      const content=disk.content;
      update(path, {
        ...disk,
        content,
        savedContent: disk.content,
        dirty: content!==disk.content,
        conflict: undefined,
        error: undefined,
      });
      setEditorEpoch((epoch) => epoch + 1);
    } else {
      update(path, {
        version: disk.version,
        conflict: undefined,
        error: undefined,
      });
      await save(path);
    }
  };
  const reload=async(path:string)=>{
    const before = docs.current[path], token = lifetimes.current.token(path);
    const disk=await readDocument(path);
    const latest = docs.current[path];
    if (!lifetimes.current.owns(path, token) || latest?.content !== before?.content || latest?.version !== before?.version)
      throw Error('文档内容已改变，请重新打开。');
    const content=disk.content;
    update(path,{...disk,content,savedContent:disk.content,dirty:content!==disk.content,conflict:undefined,error:undefined});
    if(currentActive.current===path)setEditorEpoch(epoch=>epoch+1);
  };
  const restoreHistory = async (path: string, id: string) => {
    const root = currentRoot.current, request = generation.current;
    await pending.current.get(path);
    if (request !== generation.current || root !== currentRoot.current) throw Error('知识库已切换。');
    const before = docs.current[path];
    if (!before || before.conflict || renaming.current) throw Error('请先处理文档冲突或文件操作。');
    renaming.current = true;
    try {
      const selected = await api.feature<{content:string}>('file.history-restore', {
        root, document: path, id, content: before.content, version: before.version,
      });
      const latest = docs.current[path];
      if (request !== generation.current || root !== currentRoot.current || latest?.content !== before.content
        || latest?.version !== before.version) throw Error('文档内容已改变，请重新查看差异。');
      change(path, selected.content);
      if (currentActive.current === path) setEditorEpoch(epoch => epoch + 1);
    } finally { renaming.current = false; }
  };
  useEffect(()=>{const reset=(event:Event)=>{const {ids,documents}=(event as CustomEvent<{ids:number[];documents:DiskDocument[]}>).detail;const removed=new Set(ids);for(const disk of documents){const doc=docs.current[disk.path];if(!doc)continue;try{const scene=JSON.parse(doc.content),baseline=JSON.parse(disk.content);scene.elements=scene.elements.map((element:any)=>{if(element.type!=='text'||!removed.has(element.fontFamily))return element;const saved=baseline.elements.find((e:any)=>e.id===element.id);return{...element,fontFamily:5,version:Math.max(element.version||0,saved?.version||0)+1,updated:Date.now()};});if(removed.has(scene.appState?.currentItemFontFamily))scene.appState.currentItemFontFamily=5;const content=doc.dirty?JSON.stringify(scene,null,2):disk.content;update(disk.path,{...disk,content,savedContent:disk.content,dirty:content!==disk.content,error:undefined,conflict:undefined});}catch{/* An invalid unsaved drawing stays available for conflict recovery. */}}};window.addEventListener('moyu-drawing-fonts-reset',reset);return()=>window.removeEventListener('moyu-drawing-fonts-reset',reset);},[update]);
  // Used only after an explicit save-copy successfully persisted the buffer.
  return {
    workspace,
    documents,
    docs,
    tabs,
    previewTab,
    pin,
    active,
    setActive,
    error,
    setError,
    ready,
    savePolicy,
    saveDelay,setSaveDelay,
    setSavePolicy,
    prepareClose,
    editorEpoch,
    setEditorEpoch,
    open,
    restoreDraft,
    save,
    saveAll,
    settleSaves:()=>Promise.all(pending.current.values()),
    change,
    refresh,
    replaceWorkspace,
    leaveWorkspace,
    closeTab,
    closeTabs,
    rename,
    applyFiles,
    copy,
    resolveConflict,
    reload,
    restoreHistory,
    discardTab,
    commit,
  };
}
