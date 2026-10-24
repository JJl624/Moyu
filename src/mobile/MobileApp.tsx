import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, CheckCheck, ChevronDown, ChevronRight, Clock3, File, FilePlus2, FileText, FolderOpen, FolderPlus, List, Maximize2, Minimize2, MoreHorizontal, Minus, Plus, Redo2, RefreshCw, Settings2, Share2, Trash2, Undo2, Upload, X } from 'lucide-react';
import { api, assetURL } from '../bridge';
import { useWorkspace } from '../useWorkspace';
import { settingsStore } from '../settingsStore';
import { displayName, flatten, folderOf, type DiskDocument, type FileNode, type SearchResult } from '../types';
import { paletteStyle } from '../themes';
import { fileKind } from '../fileKinds';
import { relativeLink } from '../markdownLinks';
import { standardAttachment } from '../attachmentLayout';
import { documentHeadings } from '../../shared/document-outline.mjs';
import { lineOffset } from '../../shared/search-location.mjs';
import { useSearchNavigation } from '../documents/useSearchNavigation';
import type { EditorContext, EditorHandle, EditorSelection } from '../editorTypes';
import { MobileSheet,useMobileSheetOpen } from './MobileSheet';
import { MobileMovePicker } from './MobileMovePicker';
import { MobileFileTree } from './MobileFileTree';
import { useMobileCloud } from './useMobileCloud';
import {useMobileAutoSync} from './useMobileAutoSync';
import {useMobileSyncAction} from './useMobileSyncAction';
import {MobileFormatting,shortcutOrder,contextFormats,copyTypes,type MobileFormatAction} from './MobileFormatting';
import {MobileFormatToolbar} from './MobileFormatToolbar';
import {useMobileFormatContext} from './useMobileFormatContext';
import {MobileSaveConfirmation,confirmMobileClose} from './MobileSaveConfirmation';
import {MobileShortcutSettings} from './MobileShortcutSettings';
import {MobileFileDetails} from './MobileFileDetails';
import {useMobileKeyboard} from './useMobileKeyboard';
import {Eye,EyeOff,Info} from 'lucide-react';
import {sourceFoldAt} from './foldQuote';
import {systemBarColors} from './systemBars';
import {MobileSearchInput,MobileSearchResults} from './MobileSearch';
import {useMobileViewport} from './useMobileViewport';
import {useMobileInteraction} from './useMobileInteraction';
import {useMobileReading,readingMedia,type MobileMedia} from './useMobileReading';
import {MobileMediaViewer} from './MobileMediaViewer';
import {selectedRoots,visibleFileNodes} from './fileSelection';
import {MobileSyncJob,type SyncConfig,type SyncConflict} from './sync';
import {MobileConflictReview} from './MobileConflictReview';
import {MobileSettings,type MobilePreferences} from './MobileSettings';
import {useMobileUpdates} from './useMobileUpdates';
import {MobileUpdateNotice} from './MobileUpdateSettings';
import { mobileFeature, nativeAvailable, refreshAndroidWorkspace, flushMobileDrafts } from './native';

const RichEditor = lazy(() => import('../WysiwygEditor'));
const SourceEditor = lazy(() => import('../SourceEditor'));
const ReadingView = lazy(() => import('../ReadingView'));
const HistoryDiff = lazy(() => import('../documents/HistoryDiff').then(module => ({ default: module.HistoryDiff })));
const MobileSync = lazy(() => import('./MobileSync'));
const MobileDrawing = lazy(() => import('./MobileDrawing'));
const MobileLicenses = lazy(() => import('./MobileLicenses'));
type Mode = 'edit' | 'read' | 'source';
type Sheet = { kind: 'new' | 'vault' | 'outline' | 'opened' | 'format' | 'editorMenu' | 'trash' | 'history' | 'licenses' | 'batchMove' | 'syncStatus' | 'shortcuts' }
  | { kind: 'file' | 'move' | 'details'; file: FileNode } | { kind: 'name'; type: 'file' | 'folder' | 'rename'; path?: string; name: string };
const date = (time?: number) => time ? new Date(time).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : '';
const parentJoin = (folder: string, name: string) => folder ? folder + '/' + name : name;
const message = (error: unknown) => (error as Error).message || '操作失败。';
const safePreference = (key: string, fallback: number, min: number, max: number) => Math.max(min, Math.min(max, Number(settingsStore.getItem(key)) || fallback));

export default function MobileApp() {
  useMobileViewport();
  useMobileInteraction();
  const keyboardVisible=useMobileKeyboard();
  const sheetOpen=useMobileSheetOpen();
  const ws = useWorkspace();
  const updates=useMobileUpdates(ws.ready);
  const [tab, setTab] = useState<'notes' | 'settings'>('notes');
  const [editing, setEditing] = useState(false), [mode, setMode] = useState<Mode>('read');
  const [folder, setFolder] = useState(''), [query, setQuery] = useState(''), [results, setResults] = useState<SearchResult[]>([]), [searching, setSearching] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null), [name, setName] = useState(''), [formError, setFormError] = useState(''), [busy, setBusy] = useState(false);
  const [themeChoice, setThemeChoice] = useState(settingsStore.getItem('moyu-mobile-theme') || 'system');
  const [systemDark, setSystemDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches);
  const theme: 'light' | 'dark' = themeChoice === 'system' ? systemDark ? 'dark' : 'light' : themeChoice === 'dark' ? 'dark' : 'light';
  const [preset, setPreset] = useState(settingsStore.getItem('moyu-mobile-palette') || 'frame');
  const [fontSize, setFontSize] = useState(() => safePreference('moyu-mobile-size', 17, 10, 24));
  const [codeFontSize,setCodeFontSize]=useState(()=>safePreference('moyu-mobile-code-size',14,10,24));
  const [codeWrap,setCodeWrap]=useState(()=>settingsStore.getItem('moyu-mobile-code-wrap')!=='false');
  const [uiSize,setUiSize]=useState(()=>safePreference('moyu-mobile-ui-size',14,10,24));
  const [tableZoom,setTableZoom]=useState(()=>safePreference('moyu-mobile-table-zoom',100,50,150));
  const [showHidden,setShowHidden]=useState(()=>settingsStore.getItem('moyu-mobile-show-hidden')==='true');
  const [lineHeight, setLineHeight] = useState(() => safePreference('moyu-mobile-line', 1.8, 1.4, 2.4));
  const [syncOpen, setSyncOpen] = useState(false), [notice, setNotice] = useState('');
  const [syncConflicts,setSyncConflicts]=useState<SyncConflict[]>([]),[reviewOpen,setReviewOpen]=useState(false);
  const [order,setOrder]=useState(()=>shortcutOrder(settingsStore.getItem('moyu-mobile-shortcut-order'))),[foldState,setFoldState]=useState<boolean|null>(null);
  const foldContext=useRef<EditorContext|null>(null),sourceFold=useRef<ReturnType<typeof sourceFoldAt>>(null),sheetStack=useRef<Sheet[]>([]);
  const blockContext=useRef<EditorContext|null>(null);
  const [history, setHistory] = useState<{ id: string; time: number; bytes: number }[]>([]);
  const [focusedReading,setFocusedReading]=useState(false),[media,setMedia]=useState<MobileMedia|null>(null);
  const [expanded,setExpanded]=useState<Set<string>>(new Set()),[selected,setSelected]=useState<Set<string>>(new Set()),[selecting,setSelecting]=useState(false);
  const homeScroll=useRef<HTMLDivElement>(null),homePositions=useRef({notes:0,settings:0});
  const readingPositions=useRef(new Map<string,number>());
  const [revision, setRevision] = useState<{ content: string; time: number; id: string } | null>(null);
  const [trash, setTrash] = useState<{ id: string; path: string; time: number }[]>([]);
  const editor = useRef<EditorHandle>(null), selection = useRef<EditorSelection | null>(null), scroll = useRef<HTMLDivElement>(null);
  const searchNavigation = useSearchNavigation(ws.workspace?.root || '', ws.active, mode, editor);
  const current = useRef({ ws, sheet, editing, syncOpen, reviewOpen,revision,media,selecting,busy }); current.current = { ws, sheet, editing, syncOpen, reviewOpen,revision,media,selecting,busy };
  const document = ws.documents[ws.active];
  const files = useMemo(()=>flatten(ws.workspace?.tree || []),[ws.workspace?.tree]);
  const rootNodes = ws.workspace?.tree || [];
  const cloud=useMobileCloud(ws.workspace?.root||'',rootNodes,ws.documents,ws.ready&&!editing&&!syncOpen&&tab==='notes');
  useMobileAutoSync(ws.workspace?.root||'',ws.documents,ws.ready&&!syncOpen&&!reviewOpen,ws.setError);
  const visibleNodes = rootNodes.filter(node => showHidden||!node.system && !node.companionFor && !/\.assets$/.test(node.name) && node.name !== 'code-data');
  const heads = useMemo(()=>sheet?.kind==='outline'?documentHeadings(document?.content || ''):[],[sheet?.kind,document?.content]);
  const activeKind = document ? fileKind(document.path) : 'markdown';
  const textDocument = ['markdown', 'text', 'html', 'drawing'].includes(activeKind);
  const formatTools=useMobileFormatContext(editor,editing&&mode!=='read'&&activeKind!=='drawing',ws.active,mode,!!sheet);
  useMobileReading(scroll,editing&&mode==='read',ws.active,document?.content||'',ws.setError);
  useLayoutEffect(()=>{if(!editing)homeScroll.current?.scrollTo(0,homePositions.current[tab]);},[editing,tab,syncOpen]);
  useEffect(()=>{setFocusedReading(false);setMedia(null);},[ws.active,mode,editing]);
  useEffect(()=>{for(const path of readingPositions.current.keys())if(!ws.tabs.includes(path))readingPositions.current.delete(path);},[ws.tabs]);
  useEffect(()=>{
    if(!ws.ready||!ws.workspace)return;
    const nodes=visibleFileNodes(ws.workspace.tree,showHidden),paths=new Set(nodes.map(node=>node.path)),folders=new Set(nodes.filter(node=>node.kind==='folder').map(node=>node.path));
    // A deleted destination must not be recreated by the next New/import action.
    setFolder(previous=>{let existing=previous;while(existing&&!folders.has(existing))existing=folderOf(existing);return existing;});
    const prune=(previous:Set<string>)=>[...previous].every(path=>paths.has(path))?previous:new Set([...previous].filter(path=>paths.has(path)));
    setSelected(prune);setExpanded(prune);
  },[ws.ready,ws.workspace,showHidden]);
  useEffect(()=>{settingsStore.setItem('moyu-mobile-show-hidden',String(showHidden));},[showHidden]);

  const flush = () => editor.current?.flush();
  const preserveClosedKeyboard = () => {const active=globalThis.document.activeElement;if(!keyboardVisible.current&&active instanceof HTMLElement&&active.closest('.mobile-document'))active.blur();};
  const adjustFont = (delta:number) => {preserveClosedKeyboard();setFontSize(value=>Math.max(10,Math.min(24,value+delta)));};
  // Navigation and sync may flush editor buffers, but manual mode never commits them.
  const saveAutomatic = async () => {try{flush();await flushMobileDrafts();if(current.current.ws.savePolicy!=='manual'&&!await current.current.ws.saveAll())return false;await settingsStore.flush();return true;}catch(error){current.current.ws.setError(message(error));return false;}};
  const saveDocument = async () => {try{flush();return await current.current.ws.save(current.current.ws.active);}catch(error){current.current.ws.setError(message(error));return false;}};
  const prepareDeparture = async () => {try{flush();const state=current.current.ws;if(!await state.prepareClose())return false;for(const doc of Object.values(state.docs.current))if(doc.dirty)await state.reload(doc.path);return true;}catch(error){current.current.ws.setError(message(error));return false;}};
  const prepareSync = async () => {
    try {
      flush();await flushMobileDrafts();
      const state=current.current.ws,root=state.workspace?.root;await state.settleSaves();
      const paths=Object.values(state.docs.current).filter(doc=>doc.dirty||doc.saving).map(doc=>doc.path);
      if(paths.length){
        const choice=await confirmMobileClose(paths,'sync');
        if(choice==='cancel'||current.current.ws.workspace?.root!==root)return false;
        if(choice==='save'){if(!await state.saveAll()){state.setError(Object.values(state.docs.current).find(doc=>doc.error)?.error||'请先处理文档冲突。');return false;}}
        else for(const path of paths){await state.reload(path);await mobileFeature('mobile.draft-clear',{root,path});}
      }
      await settingsStore.flush();return !Object.values(state.docs.current).some(doc=>doc.dirty||doc.saving);
    }catch(error){current.current.ws.setError(message(error));return false;}
  };
  const manualSync=useMobileSyncAction(ws.workspace?.root||'',{save:prepareSync,refresh:ws.refresh,configure:()=>{setSyncConflicts([]);setSyncOpen(true);},conflicts:value=>{setSyncConflicts(value);setNotice(value.length+' 个文件需要处理');},notice:setNotice,error:ws.setError});
  const reviewConflicts=async()=>{if(!await prepareSync())return;try{const root=current.current.ws.workspace?.root||'',config=await mobileFeature<SyncConfig>('mobile.webdav-config',{root});const names=cloud.summary.conflicts;const values=names.length===syncConflicts.length&&names.every(path=>syncConflicts.some(item=>item.path===path))?syncConflicts:await new MobileSyncJob(config,root,()=>{}).review(names);setSyncConflicts(values);setSheet(null);setReviewOpen(true);}catch(error){ws.setError(message(error));}};
  const attempt = async (action: () => Promise<unknown>) => {
    if (busy) return; setBusy(true); setFormError('');
    try { await action(); } catch (error) { setFormError(message(error)); } finally { setBusy(false); }
  };
  const closeSheet=()=>{if(current.current.busy)return;(globalThis.document.activeElement as HTMLElement|null)?.blur();setFormError('');setSheet(sheetStack.current.pop()||null);};
  const captureFormat = () => {
    selection.current=editor.current?.captureSelection?.()||null;
      const selected=selection.current,context=formatTools.capture();
      foldContext.current=null;sourceFold.current=null;blockContext.current=context;
      if(mode==='source'&&selected)sourceFold.current=sourceFoldAt(selected.sourceMarkdown||'',selected.head);
      else if(context?.can('toggleFoldDefault'))foldContext.current=context;
      setFoldState(sourceFold.current?.open??(foldContext.current?!!foldContext.current.active?.('toggleFoldDefault'):null));
  };
  const show = (value: Sheet) => {
    flush();
    if(value.kind==='format')captureFormat();else if(value.kind!=='shortcuts')selection.current = editor.current?.captureSelection?.() || null;
    if(current.current.sheet&&current.current.sheet.kind!==value.kind)sheetStack.current.push(current.current.sheet);
    (globalThis.document.activeElement as HTMLElement|null)?.blur();setFormError('');setSheet(value);if(value.kind==='name')setName(value.name);
  };
  useEffect(()=>{if(!sheet)sheetStack.current=[];},[sheet]);
  useEffect(()=>{settingsStore.setItem('moyu-mobile-shortcut-order',JSON.stringify(order));},[order]);
  const runAction = (action: MobileFormatAction) => {
    const fromSheet=!!current.current.sheet;
    const copyType=copyTypes[action as keyof typeof copyTypes];
    if(copyType){const context=fromSheet?blockContext.current:editor.current?.selectionContext?.();if(context)void mobileFeature('clipboard.write',{text:context.textFor(copyType)}).catch(error=>ws.setError(message(error)));setSheet(null);return;}
    if(action==='toggleFoldDefault'&&mode==='source'){
      if(!fromSheet)captureFormat();const fold=sourceFold.current,selected=selection.current;
      if(fold&&selected){editor.current?.restoreSelection?.({...selected,anchor:fold.marker,head:fold.marker+1});editor.current?.insert(fold.open?'-':'+');editor.current?.restoreSelection?.(selected);selection.current=null;setSheet(null);requestAnimationFrame(()=>editor.current?.focus());}return;
    }
    const editAction=action as Parameters<EditorHandle['action']>[0];
    if(contextFormats.some(item=>item.action===action)){
      const context=fromSheet?blockContext.current:editor.current?.selectionContext?.();
      if(!context?.run(action as Parameters<EditorHandle['action']>[0])){ws.setError('编辑位置已改变，请重新选择。');return;}
      selection.current=null;setSheet(null);formatTools.changed();if(fromSheet)requestAnimationFrame(()=>editor.current?.focus());return;
    }
    if(!fromSheet){
      // A shortcut keeps the live editor selection. Mapping it through Markdown
      // is only needed after a sheet has taken focus.
      if(action!=='attachment'&&action!=='foldClosed'&&action!=='foldOpen'&&action!=='tabs'&&action!=='mathblock'){editor.current?.action(editAction);return;}
      captureFormat();
    }
    if(action==='attachment'){setSheet(null);void attach();return;}
    if (fromSheet&&selection.current) editor.current?.restoreSelection?.(selection.current);
    const folding=action==='foldClosed'||action==='foldOpen',wantOpen=action==='foldOpen';
    if(folding&&sourceFold.current&&selection.current){
      const selected=selection.current,fold=sourceFold.current;
      if(fold.open!==wantOpen){editor.current?.restoreSelection?.({...selected,anchor:fold.marker,head:fold.marker+1});editor.current?.insert(wantOpen?'+':'-');editor.current?.restoreSelection?.(selected);}
    }else if(folding&&foldContext.current){if(!!foldContext.current.active?.('toggleFoldDefault')!==wantOpen)foldContext.current.run('toggleFoldDefault');}
    else if(folding){
      const selected=selection.current,source=selected?.sourceMarkdown??selected?.markdown??ws.docs.current[ws.active]?.content??'';
      const text=selected?source.slice(Math.min(selected.anchor,selected.head),Math.max(selected.anchor,selected.head)):'';
      const lines=text.replace(/\r\n/g,'\n').split('\n'),title=lines.shift()||'';
      editor.current?.insert(`> [${wantOpen?'+':'-'}] ${title}\n${(lines.length?lines:['']).map(line=>'> '+line).join('\n')}\n`);
    }else if(action==='tabs')editor.current?.insert('\n```tabs\n:::text 标签一\n\n:::text 标签二\n\n```\n');
    else if(action==='mathblock')editor.current?.insert('\n$$\n\n$$\n');
    else editor.current?.action(editAction);
    selection.current = null; setSheet(null);
    requestAnimationFrame(()=>editor.current?.focus());
  };
  const open = async (path: string, _fresh = false, line?: number) => {
    flush(); if (!await ws.open(path)) return;
    setEditing(true); setSheet(null); setMode('read');
    selection.current = null;
    if (line) { const content = ws.docs.current[path]?.content || ''; searchNavigation.reveal({root:ws.workspace?.root||'',path,offset:lineOffset(content,line),source:content}); }
  };
  const leaveEditor = async () => { if (await saveAutomatic()) { setEditing(false); setRevision(null); } };
  useEffect(()=>{if(ws.ready&&current.current.ws.active){setEditing(true);setMode('read');}},[ws.ready]);
  useEffect(()=>{setMode('read');selection.current=null;if(ws.ready&&!ws.active)setEditing(false);},[ws.active]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)'), changed = () => setSystemDark(media.matches);
    media.addEventListener('change', changed); return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    globalThis.document.documentElement.dataset.theme = theme;
    settingsStore.setItem('moyu-mobile-theme', themeChoice); settingsStore.setItem('moyu-mobile-palette', preset);
    window.dispatchEvent(new Event('moyu-diagram-theme'));
  }, [theme, themeChoice, preset]);
  useEffect(()=>{if(nativeAvailable())void mobileFeature('mobile.theme',{theme,...systemBarColors(paletteStyle(preset,theme) as Record<string,string>,editing||syncOpen||!!revision,sheetOpen)}).catch(()=>{});},[theme,preset,editing,syncOpen,sheetOpen,!!revision,!!media]);
  useEffect(() => { settingsStore.setItem('moyu-mobile-size', String(fontSize)); settingsStore.setItem('moyu-mobile-ui-size',String(uiSize));settingsStore.setItem('moyu-mobile-line', String(lineHeight));settingsStore.setItem('moyu-mobile-table-zoom',String(tableZoom)); }, [fontSize,uiSize,lineHeight,tableZoom]);
  useEffect(()=>{settingsStore.setItem('moyu-mobile-code-size',String(codeFontSize));},[codeFontSize]);
  useEffect(()=>{settingsStore.setItem('moyu-mobile-code-wrap',String(codeWrap));},[codeWrap]);
  useEffect(() => {
    const pause = () => { flush(); void flushMobileDrafts().catch(error=>current.current.ws.setError(message(error)));if(current.current.ws.savePolicy!=='manual')void current.current.ws.saveAll(); void settingsStore.flush().catch(error => current.current.ws.setError(message(error))); };
    const back = async () => {
      const state = current.current;
      if(state.media){setMedia(null);return;}
      if (state.revision) { setRevision(null); return; }
      if (state.sheet) { closeSheet(); return; }
      if (state.syncOpen||state.reviewOpen) return;
      if(state.busy)return;
      if(state.selecting){setSelecting(false);setSelected(new Set());return;}
      if (state.editing) { await leaveEditor(); return; }
      if(tab==='notes'&&query.trim()){setQuery('');const input=globalThis.document.querySelector<HTMLInputElement>('.mobile-search-field input');input?.blur();return;}
      if (tab !== 'notes') { setTab('notes'); return; }
      if (folder) { setFolder(folderOf(folder)); return; }
      if (await prepareDeparture() && nativeAvailable()) await mobileFeature('mobile.finish');
    };
    const resume = () => { void (nativeAvailable() ? refreshAndroidWorkspace() : current.current.ws.refresh()).catch(error => current.current.ws.setError(message(error))); };
    window.addEventListener('moyu-mobile-pause', pause); window.addEventListener('moyu-mobile-back', back); window.addEventListener('moyu-mobile-resume', resume);
    const visibility = () => { if (globalThis.document.visibilityState === 'hidden') pause(); };
    globalThis.document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('moyu-mobile-pause', pause); window.removeEventListener('moyu-mobile-back', back); window.removeEventListener('moyu-mobile-resume', resume); globalThis.document.removeEventListener('visibilitychange', visibility); };
  }, [folder,tab,query]);
  useEffect(() => {
    if (!ws.ready || !ws.workspace || !nativeAvailable()) return;
    let alive = true;
    void mobileFeature<{ path: string; content: string; version: string }[]>('mobile.drafts').then(async drafts => {
      for (const draft of drafts) {
        if (!alive) return;
        let disk: DiskDocument; try { disk = await api.read(draft.path); } catch { continue; }
        if (disk.content === draft.content) { await mobileFeature('mobile.draft-clear', { path: draft.path }); continue; }
        if (disk.version === draft.version) { await ws.open(draft.path); ws.change(draft.path, draft.content); setNotice('已恢复未保存的内容'); }
        else { await ws.open(draft.path);const doc=ws.docs.current[draft.path];if(doc)ws.commit({...ws.docs.current,[draft.path]:{...doc,content:draft.content,version:draft.version,dirty:true,conflict:disk}});setNotice('未保存内容与文件有冲突'); }
      }
    }).catch(error => ws.setError(message(error)));
    return () => { alive = false; };
  }, [ws.ready,ws.workspace?.root]);
  useEffect(() => {
    if (tab !== 'notes'||editing||syncOpen||!ws.ready) return;
    const ticket = { current: true },text=query.trim();if(!text){setResults([]);setSearching(false);return;}setResults([]);setSearching(true);
    const timer = setTimeout(() => {
      void api.search(text).then(results => { if (ticket.current) setResults(results); }).catch(error => { if(ticket.current) ws.setError(message(error)); }).finally(() => { if(ticket.current) setSearching(false); });
    }, 250);
    return () => { ticket.current = false; clearTimeout(timer); };
  }, [query,tab,editing,syncOpen,ws.ready,ws.workspace?.root]);
  useEffect(()=>{setFolder('');setQuery('');setResults([]);setSearching(false);setSelected(new Set());setSelecting(false);setExpanded(new Set());readingPositions.current.clear();homePositions.current={notes:0,settings:0};},[ws.workspace?.root]);
  useEffect(() => {
    if (!sheet || !nativeAvailable()) return;
    if (sheet.kind === 'history' && document) void mobileFeature<{ entries: typeof history }>('file.history-list', { document: document.path }).then(value => setHistory(value.entries)).catch(error => setFormError(message(error)));
    if (sheet.kind === 'trash') void mobileFeature<typeof trash>('mobile.trash-list').then(setTrash).catch(error => setFormError(message(error)));
  }, [sheet?.kind,document?.path]);

  const change = (value: string) => {
    const path = current.current.ws.active, doc = current.current.ws.docs.current[path];
    if(!doc||doc.content===value)return;
    current.current.ws.change(path, value);
    if (nativeAvailable()) void mobileFeature(value===doc.savedContent?'mobile.draft-clear':'mobile.draft', { root: current.current.ws.workspace?.root, path, content: value, version: doc.version }).catch(error => current.current.ws.setError(message(error)));
  };
  const nameSubmit = () => attempt(async () => {
    if (sheet?.kind !== 'name') return;
    let entered = name.trim(); if (!entered || entered === '.' || entered === '..' || /[<>:"\\|?*\x00-\x1f]/.test(entered)) throw Error('请输入有效的文件名。');
    if (entered.includes('/')) throw Error('名称不能包含斜杠。');
    if (sheet.type === 'rename') {
      const from = sheet.path!, to = parentJoin(folderOf(from), entered);
      if (to !== from) {await ws.rename(from, to);if(folder===from||folder.startsWith(from+'/'))setFolder(to+folder.slice(from.length));}
      setSheet(null); return;
    }
    if (sheet.type === 'file' && !/\.[^./]+$/.test(entered)) entered += '.md';
    const path = parentJoin(folder, entered); await api.create(path, sheet.type, ''); await ws.refresh(); setSheet(null);
    if (sheet.type === 'file') await open(path, true);
  });
  const attach = () => attempt(async () => {
    const path = ws.active, selectionAtPick = selection.current||editor.current?.captureSelection?.();
    selection.current=null;
    const attachments = await mobileFeature<{ path: string; name: string }[]>('mobile.pick-attachment', { document: path });
    if (current.current.ws.active !== path) return;
    if (!attachments.length) {requestAnimationFrame(()=>{if(selectionAtPick)editor.current?.restoreSelection?.(selectionAtPick);editor.current?.focus();});return;}
    if (selectionAtPick) editor.current?.restoreSelection?.(selectionAtPick);
    editor.current?.insert(attachments.map(file => standardAttachment(path,file.path,file.name)).join('\n'));
    await ws.refresh();
  });
  const chosen=selectedRoots(rootNodes,selected);
  const select=(path:string)=>setSelected(previous=>{const next=new Set(previous);next.has(path)?next.delete(path):next.add(path);return next;});
  const startSelection=(path:string)=>{setSelected(new Set([path]));setSelecting(true);};
  const finishSelection=()=>{setSelected(new Set());setSelecting(false);};
  const batchMove=(destination:string)=>attempt(async()=>{
    if(!await saveAutomatic())return;
    const moving=chosen.filter(file=>folderOf(file.path)!==destination),names=new Set<string>();
    // Validate every destination before moving the first item. Concurrent I/O
    // can still fail: keep the unprocessed selection available for a retry.
    for(const file of moving){
      const to=parentJoin(destination,file.name);
      if(names.has(file.name)||await api.feature<boolean>('file.exists',{path:to}))throw Error('目标文件夹已有“'+file.name+'”。');
      names.add(file.name);
      if(/\.(md|markdown)$/i.test(file.name)){
        const companion=(path:string)=>path.replace(/\.(md|markdown)$/i,'')+'.assets';
        if(await api.feature<boolean>('file.exists',{path:companion(file.path)})&&await api.feature<boolean>('file.exists',{path:companion(to)}))throw Error('目标文件夹已有“'+companion(file.name)+'”。');
      }
    }
    for(const file of moving){
      const from=file.path,to=parentJoin(destination,file.name);await ws.rename(from,to);
      setSelected(previous=>new Set([...previous].filter(path=>path!==from&&!path.startsWith(from+'/'))));
      if(folder===from||folder.startsWith(from+'/'))setFolder(to+folder.slice(from.length));
    }
    setSheet(null);finishSelection();
  });
  const batchTrash=()=>attempt(async()=>{
    if(!chosen.length||!confirm('将所选 '+chosen.length+' 项移入回收站？')||!await saveAutomatic())return;
    try{for(const file of chosen){
      if(!await ws.closeTabs(ws.tabs.filter(path=>path===file.path||path.startsWith(file.path+'/'))))return;
      await api.trash(file.path);setSelected(previous=>new Set([...previous].filter(path=>path!==file.path&&!path.startsWith(file.path+'/'))));
    }finishSelection();}finally{await ws.refresh();}
  });
  const batchShare=()=>attempt(async()=>{
    if(!chosen.length||chosen.some(file=>file.kind==='folder')||!await saveAutomatic())return;
    await mobileFeature('mobile.share-files',{root:ws.workspace?.root,paths:chosen.map(file=>file.path)});
  });
  const visitLink = (event: React.MouseEvent) => {
    const media=readingMedia(event.target as Element);if(media){setMedia(media);return;}
    const anchor = (event.target as HTMLElement).closest('a[href]'); if (!anchor) return;
    const href = anchor.getAttribute('href') || ''; if (href.startsWith('#')) return;
    event.preventDefault();
    if (/^(https?:|mailto:|tel:)/i.test(href)) void api.openExternal(href);
    else { const target = relativeLink(ws.active,href); if (files.some(file=>file.path===target)) void open(target); else ws.setError('链接指向的文件不存在。'); }
  };
  const content = document?.content || '';
  const style = {
    ...paletteStyle(preset,theme), '--mobile-size': fontSize + 'px', '--mobile-code-size':codeFontSize+'px', '--code-size':codeFontSize+'px', '--mobile-ui-size':uiSize+'px','--mobile-line': lineHeight,'--mobile-table-scale':tableZoom/100,
    '--font-ui': 'Roboto, "Noto Sans", system-ui, sans-serif', '--font-mono': 'monospace',
    '--body-font': 'Roboto, "Noto Sans", system-ui, sans-serif', '--heading-font': 'inherit',
    '--font-reading': 'inherit', '--font-readingHeading': 'inherit', '--font-readingCode': 'monospace',
    '--size-reading': fontSize + 'px', '--size-readingCode': Math.max(10,fontSize-2) + 'px', '--line-reading': lineHeight,
    '--line-readingHeading': 1.5, '--line-readingCode': 1.7, '--paragraph-gap': '14px', '--list-gap': '3px', '--heading-scale': 1,
  } as CSSProperties;

  if(reviewOpen)return <div className='app mobile-app' style={style}><MobileConflictReview root={ws.workspace?.root||''} items={syncConflicts} back={()=>setReviewOpen(false)} changed={setSyncConflicts}/><MobileSaveConfirmation/></div>;
  if (syncOpen) return <div className='app mobile-app' style={style}><Suspense fallback={<div className='mobile-loading'>正在打开同步设置…</div>}><MobileSync root={ws.workspace?.root || ''} review={items=>{setSyncConflicts(items);setReviewOpen(true);}} back={() => {setSyncOpen(false);setSyncConflicts([]);}} flush={prepareSync} refreshed={async()=>{if(nativeAvailable())await refreshAndroidWorkspace();else await ws.refresh();}} /></Suspense><MobileSaveConfirmation/>{ws.error&&<div className='mobile-error' role='alert'><span>{ws.error}</span><button aria-label='关闭错误' onClick={()=>ws.setError('')}><X size={18}/></button></div>}</div>;
  return <div className={'app mobile-app' + (editing ? ' mobile-editing' : '')+(focusedReading?' mobile-focused-reading':'')} style={style} data-code-wrap={codeWrap}>
    {editing && document ? <>
      <header className='mobile-editor-header'>
        <button aria-label='返回笔记' onClick={() => void leaveEditor()}><ArrowLeft size={22}/></button>
        <button className='mobile-document-title' onClick={() => show({kind:'opened'})}><strong>{displayName(document.path)}</strong><small>{document.saving?'正在保存':document.dirty?'未保存':'已保存'}</small></button>
        {textDocument&&activeKind!=='drawing'&&mode!=='read'&&([{action:'undo',label:'撤销',icon:Undo2},{action:'redo',label:'重做',icon:Redo2}] as const).map(item=><button key={item.action} aria-label={item.label} title={item.label} onPointerDown={event=>event.preventDefault()} onClick={()=>{
          preserveClosedKeyboard();
          editor.current?.action(item.action,{focus:false});
        }}><item.icon size={19}/></button>)}
        {(document.dirty||document.saving)&&<button className='mobile-save-button' aria-label='保存文档' disabled={document.saving} onClick={() => void saveDocument()}>{document.saving?'保存中':'保存'}</button>}
        <button aria-label='文档操作' onClick={() => show({kind:'editorMenu'})}><MoreHorizontal size={23}/></button>
      </header>
      <div className='mobile-mode-bar'>
        <div className='mobile-mode-tabs' role='tablist' aria-label='文档视图'>{(['edit','read','source'] as const).filter(value => textDocument ? activeKind==='markdown'||activeKind==='drawing'||value!=='edit' : value==='read').map(value=><button key={value} role='tab' aria-selected={mode===value} onClick={() => {if(mode===value)return;flush();selection.current=editor.current?.captureSelection?.()||null;setMode(value);}}><span>{value==='edit'?'编辑':value==='read'?'阅读':'源码'}</span></button>)}</div>
        {textDocument&&activeKind!=='drawing'&&<div className='mobile-page-font' role='group' aria-label={'页面字号 '+fontSize+' px'}><button aria-label='缩小字号' title='缩小字号' disabled={fontSize<=10} onPointerDown={event=>event.preventDefault()} onClick={()=>adjustFont(-1)}><Minus size={17}/></button><button aria-label='放大字号' title='放大字号' disabled={fontSize>=24} onPointerDown={event=>event.preventDefault()} onClick={()=>adjustFont(1)}><Plus size={17}/></button></div>}
        {mode==='read'&&<button className='mobile-reading-focus' aria-label={focusedReading?'退出专注阅读':'专注阅读'} aria-pressed={focusedReading} onClick={()=>setFocusedReading(value=>!value)}>{focusedReading?<Minimize2 size={18}/>:<Maximize2 size={18}/>}</button>}
        {activeKind==='markdown'&&<button aria-label='文档大纲' onClick={() => show({kind:'outline'})}><List size={20}/></button>}
      </div>
      {document.conflict && <div className='mobile-conflict'><strong>文件已被其他应用修改</strong><button onClick={()=>setRevision({id:'conflict',time:document.conflict!.updated,content:document.conflict!.content})}>查看差异</button></div>}
      <div className={'mobile-document document-scroll mode-'+mode} ref={scroll} onScroll={event=>{if(mode==='read')readingPositions.current.set(ws.active,event.currentTarget.scrollTop);}} onClick={mode==='read'?visitLink:undefined}
        onKeyDown={event=>{if(mode!=='read'||!['Enter',' '].includes(event.key))return;const target=event.target as Element;if(!target.matches('[role=button]'))return;const media=readingMedia(target);if(media){event.preventDefault();setMedia(media);}}}>
        <Suspense fallback={<div className='mobile-loading'>正在打开文档…</div>}>
          {activeKind==='image'?<div className='mobile-image-view'><img alt={document.path.split('/').pop()} src={assetURL('',document.path)}/></div>
            :!textDocument?<div className='mobile-empty'><File size={36}/><h2>{document.path.split('/').pop()}</h2><button className='mobile-primary' onClick={()=>void attempt(()=>mobileFeature('mobile.open-file',{path:document.path}))}>使用其他应用打开</button></div>
            :activeKind==='drawing'&&mode!=='source'?<MobileDrawing key={document.path+'-'+ws.editorEpoch} value={content} theme={theme} readOnly={mode==='read'} change={change}/>
            :mode==='read'&&activeKind!=='markdown'&&activeKind!=='html'?<article className='reading-view'><pre className='mobile-plain-text' data-source-from='0' data-source-to={content.length}>{content}</pre></article>
            :mode==='source'||activeKind!=='markdown'&&activeKind!=='html'?<SourceEditor onContextChange={formatTools.changed} autoFocus={false} key={document.path+'-'+ws.editorEpoch} ref={editor} root={ws.workspace?.root} path={document.path} value={content} savedValue={document.savedContent} onChange={change} onError={ws.setError} theme={theme} fontSize={fontSize} selection={selection.current}/>
            :activeKind==='html'?<iframe className='mobile-html-view' title='HTML 阅读' sandbox='allow-scripts' srcDoc={'<meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: data: blob:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; font-src https: data:;">'+content}/>
            :mode==='read'&&!content.trim()?<div className='mobile-empty'><FileText size={34}/><h2>空白文档</h2><button className='mobile-primary' onClick={()=>setMode('edit')}>开始编辑</button></div>
            :mode==='read'?<ReadingView key={document.path} value={content} path={document.path} scrollTop={readingPositions.current.get(document.path)||0}/>
            :<RichEditor codeWrap={codeWrap} onContextChange={formatTools.changed} autoFocus={false} key={document.path+'-'+ws.editorEpoch} ref={editor} root={ws.workspace?.root} path={document.path} value={content} savedValue={document.savedContent} onChange={change} onError={ws.setError} theme={theme} fontSize={fontSize} selection={selection.current}/>
          }
        </Suspense>
      </div>
      {textDocument&&activeKind!=='drawing'&&mode!=='read'&&<MobileFormatToolbar order={order} state={formatTools.state} busy={busy} run={runAction} more={()=>show({kind:'format'})}/>}
    </> : <>
      <main className='mobile-home-content' ref={homeScroll} onScroll={event=>{homePositions.current[tab]=event.currentTarget.scrollTop;}}>
        {tab==='notes'?<>
          <div className='mobile-list-heading'><h1 className={!selecting&&!query.trim()?'mobile-vault-heading':undefined}>{selecting?'已选 '+selected.size+' 项':query.trim()?'搜索结果':<button aria-label='选择知识库' aria-haspopup='dialog' onClick={()=>show({kind:'vault'})}><span>{ws.workspace?.name||'知识库'}</span><ChevronDown size={16}/></button>}</h1><span>{selecting?'':query.trim()?(searching?'':results.length+' 篇'):visibleFileNodes(rootNodes,showHidden).filter(file=>file.kind==='file').length+' 个文件'}</span>{selecting?<><button aria-label='全选' onClick={()=>setSelected(new Set(visibleFileNodes(rootNodes,showHidden).map(file=>file.path)))}><CheckCheck size={20}/></button><button aria-label='取消选择' onClick={finishSelection}><X size={20}/></button></>:<><button aria-label={showHidden?'隐藏附件与数据目录':'显示所有目录'} title={showHidden?'隐藏附件与数据目录':'显示所有目录'} aria-pressed={showHidden} onClick={()=>setShowHidden(value=>!value)}>{showHidden?<Eye size={19}/>:<EyeOff size={19}/>}</button><button aria-label='新建' title='新建' onClick={()=>show({kind:'new'})}><Plus size={20}/></button><button aria-label='已打开的文档' title='已打开的文档' onClick={()=>show({kind:'opened'})}><Clock3 size={19}/></button></>}</div>
          <MobileSearchInput value={query} change={setQuery}/>
          {(!query.trim()||cloud.operation)&&<div className='mobile-cloud-actions'><button className={'mobile-cloud-bar'+(cloud.summary.conflicts.length?' conflict':'')} aria-label='立即同步' disabled={manualSync.busy||!!cloud.operation} onClick={()=>void (cloud.summary.conflicts.length?reviewConflicts():manualSync.sync())}><RefreshCw size={18} className={cloud.operation?'mobile-sync-spinning':undefined}/><strong>{cloud.summary.conflicts.length?'处理冲突':'立即同步'}</strong><span>{cloud.operation?cloud.operation.stage:cloud.error||cloud.summary.error?'同步失败':cloud.summary.needsDirectoryConfirmation?'同步目录待确认':cloud.summary.needsConfirmation?'首次同步待确认':cloud.summary.pendingUploads.length?cloud.summary.pendingUploads.length+' 个文件待确认上传':!cloud.configured?'未配置':cloud.loading?'检查本地修改…':cloud.summary.conflicts.length?cloud.summary.conflicts.length+' 项需处理':Object.values(cloud.files).some(state=>['pending','local','remote'].includes(state))?'有文件待同步':cloud.summary.lastSync?'上次同步 '+new Date(cloud.summary.lastSync).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'尚未同步'}</span></button>{cloud.operation?<button aria-label='中断同步' onClick={()=>cloud.operation?.cancel()}><X size={18}/></button>:<button aria-label='同步详情' onClick={()=>show({kind:'syncStatus'})}><MoreHorizontal size={18}/></button>}</div>}
          {cloud.operation&&<div className='mobile-home-sync-progress' role='status'><progress aria-label='同步进度'/><small>{cloud.operation.path||cloud.operation.stage}</small></div>}
          {query.trim()&&<MobileSearchResults results={results} searching={searching} open={(path,line)=>void open(path,false,line)}/>}<div className='mobile-file-browser' hidden={!!query.trim()}>
          {!ws.ready?<div className='mobile-loading'>正在读取笔记…</div>:!visibleNodes.length?<div className='mobile-empty'><FileText size={38}/><h2>写下第一篇笔记</h2><p>新建笔记，或导入已有文档。</p><button className='mobile-primary' onClick={()=>show({kind:'new'})}>新建笔记</button></div>
            :<MobileFileTree key={ws.workspace?.root} tree={rootNodes} showHidden={showHidden} folder={folder} active={ws.active} states={cloud.configured?cloud.files:{}} open={path=>void open(path)} chooseFolder={setFolder} more={file=>show({kind:'file',file})} expanded={expanded} setExpanded={setExpanded} selecting={selecting} selected={selected} select={select} startSelection={startSelection}/>}</div>
        </>:<MobileSettings value={{themeChoice,preset,uiSize,fontSize,codeFontSize,codeWrap,lineHeight,tableZoom,savePolicy:ws.savePolicy}} change={(patch:Partial<MobilePreferences>)=>{
          if(patch.themeChoice!==undefined)setThemeChoice(patch.themeChoice);if(patch.preset!==undefined)setPreset(patch.preset);if(patch.uiSize!==undefined)setUiSize(patch.uiSize);
          if(patch.fontSize!==undefined)setFontSize(patch.fontSize);if(patch.codeFontSize!==undefined)setCodeFontSize(patch.codeFontSize);if(patch.codeWrap!==undefined)setCodeWrap(patch.codeWrap);if(patch.lineHeight!==undefined)setLineHeight(patch.lineHeight);if(patch.tableZoom!==undefined)setTableZoom(patch.tableZoom);if(patch.savePolicy!==undefined)ws.setSavePolicy(patch.savePolicy);
        }} vaultName={ws.workspace?.name||'知识库'} syncStatus={cloud.error||cloud.summary.error?'同步失败':!cloud.configured?'未配置':cloud.summary.lastSync?'上次 '+new Date(cloud.summary.lastSync).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'尚未同步'}
          vault={()=>show({kind:'vault'})} sync={()=>void attempt(async()=>{if(await saveAutomatic())setSyncOpen(true);})} shortcuts={()=>show({kind:'shortcuts'})} trash={()=>show({kind:'trash'})} licenses={()=>show({kind:'licenses'})} updates={updates}/>}
      </main>
      {selecting?<div className='mobile-selection-bar' role='toolbar' aria-label='文件批量操作'><button disabled={busy||!chosen.length} onClick={()=>show({kind:'batchMove'})}><FolderOpen size={20}/>移动</button><button disabled={busy||!chosen.length||chosen.some(file=>file.kind==='folder')} title='分享所选文件' onClick={()=>void batchShare()}><Share2 size={20}/>分享</button><button className='danger' disabled={busy||!chosen.length} onClick={()=>void batchTrash()}><Trash2 size={20}/>回收站</button></div>:<nav className='mobile-bottom-nav' aria-label='主导航'>{([{key:'notes',name:'笔记',icon:FileText},{key:'settings',name:'设置',icon:Settings2}] as const).map(item=><button key={item.key} aria-current={tab===item.key?'page':undefined} onClick={()=>setTab(item.key)}><span><item.icon size={22}/></span>{item.name}</button>)}</nav>}
    </>}
    {(ws.error||formError&&!sheet)&&<div className='mobile-error' role='alert'><span>{ws.error||formError}</span><button aria-label='关闭错误提示' onClick={()=>{ws.setError('');setFormError('');}}><X size={18}/></button></div>}
    {notice&&<div className='mobile-notice' role='status'><span>{notice}</span><button aria-label='关闭提示' onClick={()=>setNotice('')}><X size={18}/></button></div>}
    {sheet&&<MobileSheet title={sheet.kind==='new'?'新建':sheet.kind==='shortcuts'?'编辑工具栏':sheet.kind==='move'||sheet.kind==='batchMove'?'移动到文件夹':sheet.kind==='syncStatus'?'同步详情':sheet.kind==='name'?sheet.type==='rename'?'重命名':sheet.type==='folder'?'新建文件夹':'新建文档':sheet.kind==='vault'?'知识库':sheet.kind==='details'?'详情':sheet.kind==='file'?sheet.file.name:sheet.kind==='outline'?'文档大纲':sheet.kind==='opened'?'已打开的文档':sheet.kind==='history'?'文档历史':sheet.kind==='trash'?'回收站':sheet.kind==='licenses'?'开源许可':sheet.kind==='format'?'全部格式':'文档操作'} close={()=>!busy&&setSheet(null)} back={sheetStack.current.length?closeSheet:undefined}>
      {formError&&<p className='mobile-inline-error' role='alert'>{formError}</p>}
      {sheet.kind==='new'?<div className='mobile-actions'><button onClick={()=>show({kind:'name',type:'file',name:''})}><FilePlus2/>新建文档</button><button onClick={()=>show({kind:'name',type:'folder',name:''})}><FolderPlus/>新建文件夹</button><button disabled={busy} onClick={()=>void attempt(async()=>{const paths=await mobileFeature<string[]>('mobile.import-files',{folder});await ws.refresh();setSheet(null);if(paths[0])await open(paths[0]);})}><Upload/>导入文档</button></div>
        :sheet.kind==='name'?<form onSubmit={event=>{event.preventDefault();void nameSubmit();}}><label className='mobile-name-label'>名称<input autoFocus aria-label='名称' value={name} onChange={event=>setName(event.target.value)} placeholder={sheet.type==='file'?'例如：旅行清单.md':sheet.type==='folder'?'例如：读书笔记':'输入名称'} autoComplete='off' enterKeyHint='done'/></label><p className='mobile-caption'>{sheet.type==='file'?'未填写扩展名时使用 .md。':folder?'当前位置：'+folder:'当前位置：知识库根目录'}</p><button className='mobile-primary mobile-full' type='submit' disabled={busy||!name.trim()}>{busy?'正在处理…':'确定'}</button></form>
        :sheet.kind==='batchMove'?chosen.length?<MobileMovePicker showHidden={showHidden} tree={rootNodes} file={chosen[0]} files={chosen} busy={busy} move={destination=>void batchMove(destination)}/>:<p className='mobile-caption'>未选择文件。</p>
        :sheet.kind==='syncStatus'?<><dl className='mobile-sync-details'><dt>上次同步</dt><dd>{cloud.summary.lastSync?new Date(cloud.summary.lastSync).toLocaleString('zh-CN'):'尚未同步'}</dd><dt>待确认上传</dt><dd>{cloud.summary.pendingUploads.length} 个文件</dd><dt>待处理冲突</dt><dd>{cloud.summary.conflicts.length} 项</dd></dl>{(cloud.error||cloud.summary.error)&&<p className='mobile-inline-error'>{cloud.error||cloud.summary.error}</p>}<div className='mobile-actions'>{!!cloud.summary.conflicts.length&&<button disabled={busy} onClick={()=>void attempt(reviewConflicts)}>处理冲突</button>}<button onClick={()=>{setSheet(null);setSyncOpen(true);}}><Settings2 size={20}/>同步设置</button></div></>
        :sheet.kind==='move'?<MobileMovePicker showHidden={showHidden} tree={rootNodes} file={sheet.file} busy={busy} move={destination=>void attempt(async()=>{if(!await saveAutomatic())return;const from=sheet.file.path,to=parentJoin(destination,sheet.file.name);await ws.rename(from,to);if(folder===from||folder.startsWith(from+'/'))setFolder(to+folder.slice(from.length));setSheet(null);})}/>
        :sheet.kind==='licenses'?<Suspense fallback={<div className='mobile-loading'>正在读取许可…</div>}><MobileLicenses/></Suspense>
        :sheet.kind==='vault'?<><div className='mobile-current-vault'><FolderOpen size={24}/><div><strong>{ws.workspace?.name}</strong><p>{ws.workspace?.root==='internal'?'保存在应用内，卸载前请导出或分享文档。':'保存在所选文件夹中，卸载应用后文件仍保留。'}</p></div></div><div className='mobile-actions'><button disabled={busy} onClick={()=>void attempt(async()=>{if(!await prepareDeparture())return;const workspace=await api.openVault();if(workspace){await ws.replaceWorkspace(workspace);setFolder('');setEditing(false);setSheet(null);}})}><FolderOpen/>选择设备上的文件夹</button><button disabled={busy} onClick={()=>void attempt(async()=>{if(!await prepareDeparture())return;await ws.replaceWorkspace(await mobileFeature('mobile.internal-vault'));setFolder('');setEditing(false);setSheet(null);})}><FileText/>使用应用内知识库</button></div></>
        :sheet.kind==='details'?<MobileFileDetails file={sheet.file} vault={ws.workspace?.name||'知识库'} root={ws.workspace?.root||''} configured={cloud.configured} state={cloud.files[sheet.file.path]}/>:sheet.kind==='file'?<div className='mobile-actions'><button onClick={()=>show({kind:'details',file:sheet.file})}><Info/>详情</button><button onClick={()=>show({kind:'name',type:'rename',path:sheet.file.path,name:sheet.file.name})}><FileText/>重命名</button><button onClick={()=>show({kind:'move',file:sheet.file})}><FolderOpen/>移动</button><button onClick={()=>{startSelection(sheet.file.path);setSheet(null);}}><CheckCheck/>选择多个</button><button className='danger' disabled={busy} onClick={()=>void attempt(async()=>{if(!confirm('将“'+sheet.file.name+'”移入回收站？'))return;if(!await saveAutomatic())return;if(!await ws.closeTabs(ws.tabs.filter(path=>path===sheet.file.path||path.startsWith(sheet.file.path+'/'))))return;await api.trash(sheet.file.path);await ws.refresh();setSheet(null);})}><Trash2/>移入回收站</button></div>
        :sheet.kind==='outline'?<div className='mobile-outline'>{heads.length?heads.map((head,index)=><button style={{paddingLeft:12+(head.level-1)*14}} key={head.offset} onClick={()=>{setSheet(null);if(mode==='read')globalThis.document.querySelectorAll('.reading-view h1,.reading-view h2,.reading-view h3,.reading-view h4,.reading-view h5,.reading-view h6')[index]?.scrollIntoView({behavior:'smooth',block:'start'});else editor.current?.scrollToHeading(index);}}><small>H{head.level}</small>{head.text}</button>):<p className='mobile-caption'>正文中的 Markdown 标题会显示在这里。</p>}</div>
        :sheet.kind==='opened'?<div className='mobile-actions'><div className='mobile-opened-actions'><small>{ws.tabs.length} 篇</small><button disabled={busy||!ws.tabs.length} onClick={()=>void attempt(async()=>{flush();if(await ws.closeTabs([...ws.tabs])){setSheet(null);setEditing(false);}})}>全部关闭</button></div>{ws.tabs.length?ws.tabs.map(path=><div className='mobile-opened-row' key={path}><button onClick={()=>void open(path)}><FileText size={18}/><span>{displayName(path)}{ws.documents[path]?.dirty?' · 未保存':''}</span></button><button aria-label={'关闭 '+displayName(path)} onClick={()=>void attempt(async()=>{flush();await ws.closeTab(path);})}><X size={18}/></button></div>):<p className='mobile-caption'>还没有打开的文档。</p>}</div>
        :sheet.kind==='format'?<MobileFormatting run={runAction} state={formatTools.state} foldState={foldState} configure={()=>show({kind:'shortcuts'})}/>
        :sheet.kind==='shortcuts'?<MobileShortcutSettings order={order} change={setOrder}/>
        :sheet.kind==='history'?<div className='mobile-actions'>{history.length?history.map(item=><button key={item.id} onClick={()=>void attempt(async()=>{const selected=await mobileFeature<{content:string}>('file.history-read',{document:ws.active,id:item.id});setRevision({...selected,id:item.id,time:item.time});setSheet(null);})}><Clock3 size={19}/><span>{new Date(item.time).toLocaleString('zh-CN')}</span><ChevronRight size={18}/></button>):<p className='mobile-caption'>保存文档后生成历史记录，每分钟最多记录一次，保留 30 天。</p>}</div>
        :sheet.kind==='trash'?<div className='mobile-actions'>{trash.length?trash.map(item=><div className='mobile-trash-row' key={item.id}><div><strong>{item.path}</strong><small>{date(item.time)}</small></div><button disabled={busy} onClick={()=>void attempt(async()=>{await mobileFeature('mobile.trash-restore',{id:item.id});await ws.refresh();setTrash(await mobileFeature('mobile.trash-list'));})}>恢复</button></div>):<p className='mobile-caption'>回收站为空。</p>}</div>
        :sheet.kind==='editorMenu'?<div className='mobile-actions'><button onClick={()=>{setSheet(null);show({kind:'history'});}}><Clock3/>文档历史</button><button disabled={busy} onClick={()=>void attempt(async()=>{if(!await saveAutomatic())return;await mobileFeature('mobile.share',{name:ws.active,content:ws.docs.current[ws.active]?.content||''});setSheet(null);})}><Share2/>分享 Markdown 文件</button><button disabled={busy} onClick={()=>void attempt(async()=>{flush();await api.exportFile('md',ws.active,ws.docs.current[ws.active]?.content||'');setSheet(null);})}><Upload/>导出 Markdown 文件</button><button onClick={()=>show({kind:'name',type:'rename',path:ws.active,name:ws.active.split('/').pop()||''})}><FileText/>重命名</button></div>:null}
    </MobileSheet>}
    <MobileUpdateNotice updates={updates}/>
    {manualSync.confirmation}
    <MobileSaveConfirmation/>
    {media&&<MobileMediaViewer media={media} close={()=>setMedia(null)}/>}
    {revision&&document&&<div className='mobile-revision' role='dialog' aria-label='文档差异'><header><button aria-label='关闭差异' onClick={()=>setRevision(null)}><ArrowLeft size={22}/></button><h2>{revision.id==='conflict'?'文件冲突':'历史版本'}</h2></header><Suspense fallback={<div className='mobile-loading'>正在比较…</div>}><HistoryDiff left={revision.content} right={content} labels={[revision.id==='conflict'?'文件内容':'历史内容','当前内容']}/></Suspense><footer>{revision.id==='conflict'?<><button onClick={()=>void attempt(async()=>{await ws.resolveConflict(ws.active,'disk');setRevision(null);})}>使用文件内容</button><button className='mobile-primary' onClick={()=>void attempt(async()=>{await ws.resolveConflict(ws.active,'mine');setRevision(null);})}>保留当前内容</button></>:<button className='mobile-primary' disabled={busy} onClick={()=>void attempt(async()=>{if(!confirm('用此历史版本替换当前内容？当前内容会先保留到历史记录。'))return;flush();await mobileFeature('file.history-capture',{document:ws.active,content:ws.docs.current[ws.active]?.content||''});await ws.restoreHistory(ws.active,revision.id);await ws.save(ws.active);setRevision(null);})}>恢复此版本</button>}</footer></div>}
  </div>;
}
