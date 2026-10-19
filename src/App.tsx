import { AppUpdates } from './AppUpdates';
import { createElementContextMenu } from './documents/elementContextMenu';
import { DocumentOutline } from './DocumentOutline';
import { documentHeadings } from '../shared/document-outline.mjs';
import { DocumentHistory } from './documents/DocumentHistory';
import { FileNameInput } from './workspace/FileNameInput';
import { useWorkspaceSearch } from './workspace/useWorkspaceSearch';
import { useSearchNavigation } from './documents/useSearchNavigation';
import { lineOffset } from '../shared/search-location.mjs';
import { isComposingKey } from './keyboardComposition';
import { useTerminalPane } from './terminal/useTerminalPane';
import { FormattingToolbar } from './documents/FormattingToolbar';
import { DocumentBoundary } from './documents/DocumentBoundary';
import { Logo } from './ui/Logo';
import { IconButton } from './ui/IconButton';
import { FileTree } from './workspace/FileTree';
import './workspace/fileExplorer.css';
import {TerminalSquare} from 'lucide-react';
import {TerminalDivider} from "./terminal/TerminalDivider";
import "./terminal/terminal.css";
import {normalizeCodeIds} from './codeIds';
import {codeId} from '../shared/code-documents.mjs';
import {
  AlertCircle,
  ArrowDownUp,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  Cloud,
  Code2,
  Download,
  Files,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Eye,
  EyeOff,
  History,
  Keyboard,
  List,
  LoaderCircle,
  Menu,
  Minus,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelRightClose,
  Paperclip,
  PencilLine,
  Plus,
  Search,
  Settings2,
  Square,
  Star,
  Sun,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { wikiPath } from '../shared/wiki-links.mjs';
import { standardAttachment } from './attachmentLayout';
import { AttachmentsPanel } from './Attachments';
import { api } from './bridge';
import { DataPanel } from './DataPanel';
import type { DrawingHandle } from './DrawingEditor';
import type { AttachmentDeletion, EditorAction, EditorHandle } from './editorTypes';
import { ElementMenu, type ElementMenuState } from './ElementMenu';
import { useMenuPlacement } from './useMenuPlacement';
import { DrawingsPanel, WebDAVPanel } from './FeaturePanels';
import { FileIcon } from './FileIcon';
import { companionNode, explorerTree, normalizeOrder, sortLabels, type ExplorerOrder } from "./workspace/fileExplorer";
import { ExplorerSortMenu } from "./workspace/ExplorerSortMenu";
import ImageViewer, { isImage } from './ImageViewer';
import {fileKind,isNativeImage} from './fileKinds';
const TextFileEditor = lazy(() => import('./TextFileEditor'));
const TerminalPanel=lazy(()=>import("./terminal/TerminalPanel").then(module=>({default:module.TerminalPanel})));
const HTMLFileViewer = lazy(() => import('./HTMLFileViewer'));
const PdfViewer = lazy(() => import('./PdfViewer'));
const SqliteViewer = lazy(() => import('./SqliteViewer'));
import { InlineCodeLayer } from './InlineCodeLayer';
import { relativeLink } from './markdownLinks';
import { Modal } from './Modal';
import { ConflictComparison } from './ConflictComparison';
import Navigation from './Navigation';
import { appearanceStyle, loadAppearance, Preferences } from './Preferences';
import { resourcePath,invalidateResourceImages } from './resourcePreview';
import { settingsStore } from './settingsStore';
import { flushPreferences } from './preferenceDraft';
import { SidebarDivider } from './SidebarDivider';
import { paletteStyle } from './themes';
import type { DiskDocument, Workspace } from './types';
import {
  displayName,
  type FileNode,
  flatten,
  folderOf,
  wordCount,
} from './types';
import { useCodeRuns } from './useCodeRuns';
import { useDocumentPositions } from './documents/useDocumentPositions';
import { useFileHistory } from './useFileHistory';
import { useWorkspace } from './useWorkspace';

const WysiwygEditor = lazy(() => import('./WysiwygEditor'));
const ReadingView = lazy(() => import('./ReadingView'));
const SourceEditor = lazy(() => import('./SourceEditor'));
const DrawingEditor = lazy(() => import('./DrawingEditor'));
type View = 'files' | 'search' | 'favorites' | 'history' | 'webdav' | 'drawings';
type Dialog =
  | { kind: 'rename'; path: string }
  | { kind: 'trash'; path: string; link?: AttachmentDeletion }
  | { kind: 'settings' | 'shortcuts'; category?: string }
  | null;





export default function App() {
  const ws = useWorkspace();
  const [home, setHome] = useState(false);
  const [elementMenu, setElementMenu] = useState<
    | ElementMenuState
    | null
  >(null);
  const [syncFiles, setSyncFiles] = useState<Record<string, string>>({});
  const [syncPhase, setSyncPhase] = useState('');
  const [treeSelection, setTreeSelection] = useState('');
  useEffect(() => setTreeSelection(ws.active), [ws.active]);
  useEffect(() => {
    if (!api.desktop || !ws.workspace || syncPhase === 'syncing') return;
    let alive = true;
    void api.feature<{ files: Record<string, string> }>('webdav.status').then(s => {
      if (alive) setSyncFiles(s.files);
    }).catch(() => {
      if (alive) setSyncFiles({});
    });
    return () => {
      alive = false;
    };
  }, [ws.workspace?.root, ws.workspace?.tree, syncPhase]);
  useEffect(() => {
    const warning = (e: Event) => setToast((e as CustomEvent).detail);
    window.addEventListener('moyu-storage-error', warning);
    return () => window.removeEventListener('moyu-storage-error', warning);
  }, []);
  useEffect(() => {
    const listener = (e: Event) => setSyncPhase((e as CustomEvent).detail);
    window.addEventListener('moyu-sync-phase', listener);
    return () => window.removeEventListener('moyu-sync-phase', listener);
  }, []);
  useEffect(() => api.onSync?.(job => {
    if (job.root !== ws.workspace?.root) return;
    setSyncPhase(['scan', 'transfer'].includes(job.phase) ? 'syncing' : job.phase);
  }), [ws.workspace?.root]);
  const [view, setView] = useState<View>('files');
  const [appearance, setAppearance] = useState(loadAppearance);
  useEffect(()=>{settingsStore.setItem('moyu-appearance',JSON.stringify(appearance));},[appearance]);
  const { selections, scrollPositions, modeSelections, forget: forgetPosition } = useDocumentPositions(ws.workspace?.root, ws.tabs);
  const [theme, setTheme] = useState<'dark' | 'light'>(
    settingsStore.getItem('moyu-theme') === 'light' ? 'light' : 'dark',
  );
  const [fontSize, setFontSize] = useState(() => {
    const value = Number(settingsStore.getItem('moyu-fontsize') ?? 16);
    return Number.isFinite(value) ? Math.min(28, Math.max(12, value)) : 16;
  });
  const [wide, setWide] = useState(
    settingsStore.getItem('moyu-wide') === 'true',
  );
  const [sidebar, setSidebar] = useState(true);
  const fileClipboard=useRef<{path:string;cut:boolean}|null>(null);
  const [orphans,setOrphans]=useState<{document:string;directory:string;candidates:string[]}[]>([]);
  useEffect(()=>{let alive=true;if(ws.workspace?.root&&api.desktop)void api.feature<typeof orphans>('file.orphans').then(data=>{if(alive)setOrphans(data);}).catch(e=>ws.setError(e.message));return()=>{alive=false;};},[ws.workspace?.root]);
  const [dataReveal,setDataReveal]=useState({key:'',request:0});
  useEffect(()=>{setDataReveal({key:'',request:0});},[ws.active]);
  useEffect(()=>{fileClipboard.current=null;},[ws.workspace?.root]);
  const [rightbar, setRightbar] = useState(false);
  const { terminalCount, setTerminalCount, terminalMounted, terminalVisible, setTerminalVisible, terminalDirection, setTerminalDirection, terminalSizes, setTerminalSizes, toggleTerminal } = useTerminalPane();
  
  
  
  
  
  const [rightTab, setRightTab] = useState<'outline' | 'attachments' | 'data'>('outline');
  const [drawingAllowed, setDrawingAllowed] = useState(false);
  const [formatbar, setFormatbar] = useState(
    settingsStore.getItem('moyu-formatbar') === 'true',
  );
  const [lineHeight, setLineHeight] = useState(() => {
    const value = Number(settingsStore.getItem('moyu-lineheight') ?? 1.75);
    return Number.isFinite(value) ? Math.min(2.4, Math.max(1.3, value)) : 1.75;
  });
  const [markdownMode, setMode] = useState<'rich' | 'source' | 'read'>('rich');
  const mode = /\.(md|markdown)$/i.test(ws.active) && !ws.active.startsWith('.data/') ? markdownMode : 'source';
  const [expanded, setExpanded] = useState(new Set(['随手记', '项目']));
  const [selectedFolder, setSelectedFolder] = useState('');
  const [fileCreation,setFileCreation]=useState<{kind:'new'|'folder';parent:string}|null>(null);
  const [fileView, setFileView] = useState<'workspace' | 'document'>('workspace');
  const [showCompanions, setShowCompanions] = useState(settingsStore.getItem('moyu-show-companions') === 'true');
  const [fileOrder, setFileOrder] = useState<ExplorerOrder[]>(() => {
    try {
      return normalizeOrder(JSON.parse(settingsStore.getItem('moyu-file-order') || 'null'));
    } catch { return normalizeOrder(null); }
  });
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);
  const assets = useMemo(() => companionNode(ws.workspace?.tree || [], ws.active), [ws.workspace?.tree, ws.active]);
  const fileNodes = useMemo(() => explorerTree(
    fileView === 'document' ? assets ? [assets] : [] : ws.workspace?.tree || [],
    fileOrder, fileView === 'document' || showCompanions,
  ), [ws.workspace?.tree, assets, fileView, fileOrder, showCompanions]);
  useEffect(() => { settingsStore.setItem('moyu-show-companions', String(showCompanions)); }, [showCompanions]);
  useEffect(() => { settingsStore.setItem('moyu-file-order', JSON.stringify(fileOrder)); }, [fileOrder]);
  useEffect(() => {
    if (fileView !== 'document') return;
    setSelectedFolder(assets?.path || '');
    if (assets) setExpanded(previous => new Set([...previous, assets.path]));
  }, [fileView, assets?.path]);
  const [favoriteMap, setFavoriteMap] = useState<Record<string, string[]>>(
    () => {
      try {
        return JSON.parse(settingsStore.getItem('moyu-favorites') ?? '{}');
      } catch {
        return {};
      }
    },
  );
  const favorites = favoriteMap[ws.workspace?.root ?? ''] ?? [];
  const drawingEditor=useRef<DrawingHandle|null>(null);
  const windowCloseTask=useRef<Promise<void>|null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [formName, setFormName] = useState('');
  const [formFolder, setFormFolder] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  
  
  
  useEffect(() => {
    const result = (e: Event) => notify((e as CustomEvent).detail);
    window.addEventListener('moyu-result-message', result);
    return () => window.removeEventListener('moyu-result-message', result);
  }, []);
  const [context, setContext] = useState<
    {
      x: number;
      y: number;
      node: FileNode;
    } | null
  >(null);
  const fileMenuElement = useRef<HTMLDivElement>(null);
  useMenuPlacement(fileMenuElement, context?.x || 0, context?.y || 0, !!context);
  const [menu, setMenu] = useState<'document' | 'format' | 'insert' | null>(
    null,
  );
  const [toast, setToast] = useState('');
  const [conflictDismissed, setConflictDismissed] = useState('');
  const editor = useRef<EditorHandle>(null);
  const currentLocation = useRef({ path: ws.active, root: ws.workspace?.root });
  currentLocation.current = { path: ws.active, root: ws.workspace?.root };
  const searchInput = useRef<HTMLInputElement>(null);
  const activeDoc = ws.documents[ws.active];
  const searchNavigation = useSearchNavigation(ws.workspace?.root || '', ws.active,
    ws.workspace?.readOnly && mode === 'rich' ? 'read' : mode, editor);
  const binaryReadOnly = ['image','pdf','sqlite'].includes(fileKind(ws.active));
  useLayoutEffect(() => {
    const tabs = document.querySelector<HTMLElement>('.tabs'),
      active = tabs?.querySelector<HTMLElement>('.tab.active');
    if (!tabs || !active) return;
    const outer = tabs.getBoundingClientRect(), inner = active.getBoundingClientRect();
    if (inner.right > outer.right) tabs.scrollLeft += inner.right - outer.right;
    else if (inner.left < outer.left) tabs.scrollLeft -= outer.left - inner.left;
  }, [ws.active, ws.tabs]);
  const markdownValue = /\.(md|markdown)$/i.test(ws.active) ? activeDoc?.content || '' : '';
  const lastNote = useRef({ root: '', path: '' });
  if (lastNote.current.root !== ws.workspace?.root) {
    lastNote.current = { root: ws.workspace?.root || '', path: '' };
  }
  if (/\.(md|markdown)$/i.test(ws.active)) lastNote.current.path = ws.active;
  const notePath = lastNote.current.path;
  const drawing = /\.excalidraw$/i.test(ws.active) ? activeDoc : null;
  const capture = () => {
    if(!ws.active||!ws.docs.current[ws.active]){editor.current?.flush();return;}
    const selected = editor.current?.captureSelection?.();
    if (selected) {
      modeSelections.current.set(ws.active + '\0' + mode, selected);
      const previous = selections.current.get(ws.active);
      selections.current.set(ws.active, {
        ...selected,
        sourceScroll: selected.sourceScroll ?? previous?.sourceScroll,
        sourceMarkdown: selected.sourceMarkdown ?? previous?.sourceMarkdown,
      });
    }
    scrollPositions.current.set(
      ws.active + '\0' + mode,
      selected?.scrollTop ?? document.querySelector('.document-scroll')?.scrollTop ?? 0,
    );
    editor.current?.flush();
  };
  const currentSelection = selections.current.get(ws.active);
  const previousModeSelection = modeSelections.current.get(ws.active + '\0' + mode);
  const sameCaret = previousModeSelection && currentSelection
    && previousModeSelection.anchor === currentSelection.anchor
    && previousModeSelection.head === currentSelection.head;
  const restoredSelection = currentSelection
    ? {
      ...currentSelection,
      ...(sameCaret
        ? {
          caretOffset: previousModeSelection.caretOffset,
          codeScroll: previousModeSelection.codeScroll,
          rich: previousModeSelection.rich,
          markdown: previousModeSelection.markdown,
          sourceScroll: previousModeSelection.sourceScroll,
          sourceMarkdown: previousModeSelection.sourceMarkdown,
          viewportAnchor: previousModeSelection.viewportAnchor,
        }
        : {}),
      scrollTop: currentSelection.mode === mode || sameCaret
        ? scrollPositions.current.get(ws.active + '\0' + mode) ?? currentSelection.scrollTop
        : currentSelection.scrollTop,
    }
    : undefined;
  const openNavigation = () => {
    capture();
    setHome(true);
  };
  const closeNavigation = useCallback(() => setHome(false), []);
  const switchMode = (next: typeof mode) => {
    capture();
    setMode(next);
  };
  const files = useMemo(
    () => flatten(ws.workspace?.tree ?? []),
    [ws.workspace?.tree],
  );
  const resourceVersions = useRef(new Map<string, string>());
  useEffect(() => {
    const previous = resourceVersions.current,
      next = new Map(
        files.filter(f => /\.excalidraw$/i.test(f.path)||isNativeImage(f.path)).map(f => [f.path, String(f.updated)+':'+f.size]),
      );
    resourceVersions.current = next;
    const changed = [...new Set([...previous.keys(), ...next.keys()])].filter(p =>
      previous.get(p) !== next.get(p)
    );
    invalidateResourceImages(ws.workspace?.root||'',changed);
    if (changed.length) {
      window.dispatchEvent(new CustomEvent('moyu-resources-changed', { detail: changed }));
    }
  }, [files,ws.workspace?.root]);
  const currentWords = useMemo(() => wordCount(markdownValue), [markdownValue]);
  const headings = useMemo(() => documentHeadings(markdownValue), [markdownValue]);
  const folders = useMemo(() => {
    const walk = (nodes: FileNode[]): FileNode[] =>
      nodes.flatMap((n) => n.kind === 'folder' ? [n, ...walk(n.children ?? [])] : []);
    return walk(ws.workspace?.tree ?? []);
  }, [ws.workspace?.tree]);
  const notify = useCallback((message: string) => setToast(message), []);
  const codeRuns = useCodeRuns(ws.workspace?.root || '', ws.active, markdownValue, ws.tabs, content=>{const value=editor.current?.ensureCodeIds?.()||normalizeCodeIds(ws.workspace?.root,ws.active,content).content;ws.change(ws.active,value);return value;});
  const imagePath = (image: HTMLImageElement) => {
    const src = image.getAttribute('src') || '';
    try {
      return src.startsWith('moyu-asset:')
        ? decodeURIComponent(new URL(src).pathname.slice(1))
        : relativeLink(ws.active, src);
    } catch {
      return '';
    }
  };
  const safe = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (err) {
      notify((err as Error).message);
    }
  };
  const closeDialog = useCallback(() => {
    if (!busy) {
      void flushPreferences().then(() => {setDialog(null);setFormError('');}).catch(e => notify(e.message));
    }
  }, [busy]);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.dispatchEvent(new Event('moyu-diagram-theme'));
    settingsStore.setItem('moyu-theme', theme);
  }, [theme]);
  useEffect(() => {
    window.dispatchEvent(new Event('moyu-diagram-theme'));
  }, [
    appearance.bodyFont,
    appearance.roleFonts.reading?.family,
    appearance.preset,
    appearance.accent,
  ]);
  useEffect(() => {
    settingsStore.setItem('moyu-fontsize', String(fontSize));
    settingsStore.setItem('moyu-wide', String(wide));
    settingsStore.setItem('moyu-formatbar', String(formatbar));
    settingsStore.setItem('moyu-lineheight', String(lineHeight));
  }, [fontSize, wide, formatbar, lineHeight]);
  useEffect(() => {
    settingsStore.setItem('moyu-favorites', JSON.stringify(favoriteMap));
  }, [favoriteMap]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (ws.error) {
      notify(ws.error);
      ws.setError('');
    }
  }, [ws.error]);
  useEffect(() => {
    setConflictDismissed('');
  }, [ws.active]);
  useEffect(() => {
    if (view === 'search') searchInput.current?.focus();
  }, [view]);
  const { query, setQuery, results, searching } = useWorkspaceSearch(ws.workspace?.tree, notify);
  useEffect(() => {
    if (!context && !menu) return;
    const dismiss = () => {
      setContext(null);
      setMenu(null);
    };
    const timer = setTimeout(
      () => window.addEventListener('click', dismiss),
      0,
    );
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', dismiss);
    };
  }, [context, menu]);
  const beforeFeatureAction = async () => {
    await flushPreferences();
    editor.current?.flush();
    await drawingEditor.current?.flush();
    if (ws.savePolicy === 'realtime' && !(await ws.saveAll())) throw new Error('请先处理文档保存错误或冲突。');
  };
  const closeDocuments = async (paths: string[]) => {
    searchNavigation.cancel();
    capture();
    await drawingEditor.current?.flush();
    await ws.closeTabs(paths);
    for(const path of paths)if(!ws.docs.current[path]){
      forgetPosition(path);
    }
  };
  const beforeWorkspaceChange = async () => {
    capture();
    await drawingEditor.current?.flush();
    await flushPreferences();
    if (!(await ws.prepareClose())) throw new Error('已取消切换知识库。');
  };
  const closeDrawing = async () => {
    await closeDocuments([ws.active]);
  };
  const openDocument = async (path: string, preview = false) => {
    searchNavigation.cancel();
    if (path === ws.active && ws.docs.current[path]) {
      if (!preview) ws.pin(path);
      setHome(false);
      setSelectedFolder('');
      setTreeSelection(path);
      return true;
    }
    capture();
    setHome(false);
    if (!(await ws.open(path, preview))) return false;
    setSelectedFolder('');
    setTreeSelection(path);
    const parents = path.split('/').slice(0, -1);
    setExpanded(previous =>
      new Set([...previous, ...parents.map((_, index) => parents.slice(0, index + 1).join('/'))])
    );
    return true;
  };
  const openSearchResult = async (path: string, preview: boolean, line?: number) => {
    const root = ws.workspace?.root || '';
    if (await openDocument(path, preview) && line !== undefined && currentLocation.current.root === root) {
      const content = ws.docs.current[path]?.content;
      if (content !== undefined) searchNavigation.reveal({ root, path, offset: lineOffset(content, line), source: content });
    }
  };
  const fileHistory = useFileHistory(
    ws.workspace?.root || '',
    ws.active,
    path => files.some(file => file.path === path),
    openDocument,
  );
  useEffect(() => {
    const listener = (event: Event) => {
      const { href, wiki, document: from } =
        (event as CustomEvent<{ href: string; wiki?: boolean; document: string }>).detail;
      if (/^(https?:|mailto:)/i.test(href)) void safe(() => api.openExternal(href));
      else {
        const target = wiki ? wikiPath(from, href, files) : relativeLink(from, href);
        if (target) void safe(() => openDocument(target));
      }
    };
    window.addEventListener('moyu-open-link', listener);
    return () => window.removeEventListener('moyu-open-link', listener);
  });
  const drawingCreation = useRef(false);
  const createDrawing = async (insertInNote = false) => {
    if (drawingCreation.current) return;
    if (insertInNote && !editor.current?.canInsertDrawing?.()) {
      throw new Error('请在正文中插入绘图链接。');
    }
    const insertion = insertInNote && mode === 'rich' ? editor.current?.prepareDrawingInsert?.() : null;
    if (insertInNote && mode === 'rich' && !insertion) throw new Error('请在正文中插入绘图链接。');
    drawingCreation.current = true;
    try {
      const currentPath = ws.active,
        currentRoot = ws.workspace?.root,
        selection = insertion ? undefined : editor.current?.captureSelection?.();
      if (!insertion) capture();
      const document = notePath || '文档.md';
      const base = await api.feature<string>('attachment.target', {
        document,
        name: '未命名绘图.excalidraw',
      });
      if (
        currentLocation.current.root !== currentRoot
        || insertInNote && currentLocation.current.path !== currentPath
      ) throw new Error('当前文档已切换，请重新插入绘图。');
      let index = 1,
        path = base;
      while (files.some((f) => f.path === path)) {
        path = base.replace(/\.excalidraw$/i, ' ' + index++ + '.excalidraw');
      }
      await api.feature<DiskDocument>('drawing.create', { path });
      if (
        currentLocation.current.root !== currentRoot
        || insertInNote && currentLocation.current.path !== currentPath
      ) {
        await ws.refresh();
        notify('绘图已创建，当前文档已切换。');
        return;
      }
      if (insertInNote && /\.(md|markdown)$/i.test(currentPath)) {
        const link = standardAttachment(currentPath, path, '绘图');
        if (insertion) {
          if (!insertion.insert(link)) throw new Error('插入位置已失效，已保存绘图在附件中。');
        } else {
          if (selection) editor.current?.restoreSelection?.(selection);
          if (!editor.current?.canInsertDrawing?.()) throw new Error('绘图已创建，请在正文中插入链接。');
          editor.current?.insert(link);
        }
        editor.current?.flush();
        if (ws.savePolicy === 'realtime' && !(await ws.save(currentPath))) {
          throw new Error('绘图已创建，但笔记保存失败。');
        }
      }
      await openDocument(path);
      await ws.refresh();
    } finally {
      insertion?.cancel();
      drawingCreation.current = false;
    }
  };
  const insertDrawing = async (_image: string, source: string) => {
    await api.feature('clipboard.write', {
      text: standardAttachment(notePath || '文档.md', source, '绘图'),
    });
    notify('已复制绘图链接');
  };
  const toggleFavorite = (path: string) => {
    const root = ws.workspace?.root ?? '';
    setFavoriteMap((previous) => ({
      ...previous,
      [root]: (previous[root] ?? []).includes(path)
        ? previous[root].filter((item) => item !== path)
        : [...(previous[root] ?? []), path],
    }));
  };
  const showNew = (kind: 'new' | 'folder', requestedParent?: string) => {
    if (busy || !ws.workspace) return;
    const visibleFolders = new Set<string>();
    const collect = (nodes: FileNode[]) => {
      for (const node of nodes) if (node.kind === 'folder') {
        visibleFolders.add(node.path);
        collect(node.children || []);
      }
    };
    collect(fileNodes);
    let parent = requestedParent ?? (treeSelection
      ? folders.some(folder => folder.path === treeSelection) ? treeSelection : folderOf(treeSelection)
      : selectedFolder || folderOf(ws.active));
    if (fileView === 'document' && !visibleFolders.has(parent)) parent = assets?.path || '';
    else while (parent && !visibleFolders.has(parent)) parent = folderOf(parent);
    setFileCreation({ kind, parent });
    setView('files');
    setSidebar(true);
    setHome(false);
    setExpanded(previous => {
      const next = new Set(previous);
      let path = '';
      for (const part of parent.split('/').filter(Boolean)) {
        path = path ? path + '/' + part : part;
        next.add(path);
      }
      return next;
    });
  };
  useEffect(()=>{setFileCreation(null);},[ws.workspace?.root,fileView]);
  const createInline = async (name:string) => {
    if(!fileCreation)return;
    const root=ws.workspace?.root, isFolder=fileCreation.kind==='folder';
    const filename=isFolder || /\.(md|markdown)$/i.test(name)?name:name+'.md';
    const target=[fileCreation.parent,filename].filter(Boolean).join('/');
    setBusy(true);
    try{await api.create(target,isFolder?'folder':'file','');
      if(currentLocation.current.root!==root)return;
      await ws.refresh();if(currentLocation.current.root!==root)return;setFileCreation(null);setTreeSelection(target);setSelectedFolder(isFolder?target:fileCreation.parent);
      if(isFolder)setExpanded(previous=>new Set([...previous,target]));else await openDocument(target);
    }finally{setBusy(false);}
  };
  const showRename = (path: string) => {
    setDialog({ kind: 'rename', path });
    setFormName(
      path
        .split('/')
        .pop()!
        .replace(/\.(md|markdown|excalidraw)$/i, ''),
    );
    setFormFolder(folderOf(path));
    setFormError('');
  };
  const openWorkspace = () =>
    safe(async () => {
      await beforeWorkspaceChange();
      const next = await api.openVault();
      if (next) await enterWorkspace(next);
    });
  const enterWorkspace = async (next: Workspace) => {
    if (next.root === ws.workspace?.root) {
      setHome(false);
      return;
    }
    selections.current.clear();
    await ws.replaceWorkspace(next);
    setSelectedFolder('');
    setExpanded(new Set(next.tree.filter(node => node.kind === 'folder').map(node => node.path)));
    setMode('rich');
    setView('files');
    setSidebar(true);
    setHome(false);
  };
  const importDocuments = () =>
    safe(async () => {
      const paths = await api.importFiles();
      await ws.refresh();
      if (paths[0]) await openDocument(paths[0]);
      if (paths.length) notify(`已导入 ${paths.length} 篇文档`);
    });
  const createOrRename = async (event: React.FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== 'rename') return;
    const name = formName.trim();
    if (
      !name
      || /[\\/<>:"|?*]/.test(name)
      || name.startsWith('.')
      || name.endsWith('.')
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)
    ) {
      setFormError('请输入有效名称，不要包含 / \\ : * ? 等特殊字符。');
      return;
    }
    const existingNode = [...files,...folders].find(file=>file.path===dialog.path);
    const isFolder = existingNode?.kind === 'folder';
    const filename = isFolder
      ? name
      : !/\.(md|markdown|excalidraw)$/i.test(dialog.path || '')
      ? name
      : dialog.path?.endsWith('.excalidraw')
      ? name.endsWith('.excalidraw')
        ? name
        : name + '.excalidraw'
      : /\.(md|markdown)$/i.test(name)
      ? name
      : name + '.md';
    const target = [formFolder, filename].filter(Boolean).join('/');
    setBusy(true);
    setFormError('');
    try {
        capture();
        if (!(await ws.rename(dialog.path!, target))) return;
        const root = ws.workspace!.root;
        setFavoriteMap((previous) => ({
          ...previous,
          [root]: (previous[root] ?? []).map((path) =>
            path === dialog.path || path.startsWith(dialog.path! + '/')
              ? target + path.slice(dialog.path!.length)
              : path
          ),
        }));
      if (formFolder) {
        setExpanded((previous) => new Set([...previous, formFolder]));
      }
      setDialog(null);
      notify('名称及相关链接已更新');
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const moveFile=(from:string,parent:string)=>void safe(async()=>{const to=(parent?parent+'/':'')+from.split('/').pop();if(from===to)return;capture();await ws.rename(from,to);});
  const clipboardAction=(action:'cut'|'copy'|'paste',path:string,parent:string)=>{if(action!=='paste'){fileClipboard.current={path,cut:action==='cut'};return;}const clipboard=fileClipboard.current;if(!clipboard)return;void safe(async()=>{capture();const folder=folders.some(f=>f.path===path)?path:parent;let to=(folder?folder+'/':'')+clipboard.path.split('/').pop();if(!clipboard.cut){const name=to.split('/').pop()!,dot=name.lastIndexOf('.'),stem=dot>0?name.slice(0,dot):name,extension=dot>0?name.slice(dot):'';let number=1;while(files.some(f=>f.path===to)||folders.some(f=>f.path===to))to=(folder?folder+'/':'')+stem+' 副本'+(number++>1?' '+(number-1):'')+extension;await ws.copy(clipboard.path,to);}else{if(to!==clipboard.path)await ws.rename(clipboard.path,to);fileClipboard.current=null;}});};
  const removeFile = async (path: string) => {
    capture();
    const removed = ws.tabs.filter(tab => tab === path || tab.startsWith(path + '/'));
    if (!(await ws.prepareClose(removed))) return false;
    const result=api.desktop?await api.feature<{cancelled?:boolean;documents:DiskDocument[];buffers:{original:string;path:string;content:string}[]}>('file.trash',{path,buffers:Object.values(ws.documents).filter(d=>/\.(md|markdown)$/i.test(d.path)).map(d=>({path:d.path,content:d.content,version:d.version}))}):(await api.trash(path),{documents:[],buffers:[]});if(result.cancelled)return false;ws.applyFiles(result);
    for (const tab of removed) ws.discardTab(tab);
    await ws.refresh();
    return true;
  };
  const trash = async (path: string, link?: AttachmentDeletion) => {
    setBusy(true);
    try {
      if (link && !link.valid()) throw new Error('文档已改变，请重新选择附件。');
      if (!(await removeFile(path))) return;
      if (link) {
        if (!link.remove()) throw new Error('附件已移至回收站，但文档已改变，请手动删除链接。');
        editor.current?.flush();
      }
      setDialog(null);
      notify(api.desktop ? '已移至系统回收站' : '已移至浏览器恢复副本');
      if (link) requestAnimationFrame(() => editor.current?.focus());
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const showAttachmentTrash = (path: string, target: HTMLElement, coords: { left: number; top: number }) => {
    if (target.closest('.image-viewer')) {
      setFormError('');
      setDialog({ kind: 'trash', path });
      return;
    }
    let link = mode === 'read' ? null : editor.current?.prepareAttachmentDelete?.(target, coords);
    if (mode === 'read') {
      const element = target.closest<HTMLElement>('[data-source-from]');
      const current = activeDoc, from = Number(element?.dataset.sourceFrom), to = Number(element?.dataset.sourceTo);
      if (current && Number.isInteger(from) && Number.isInteger(to) && to > from && to <= current.content.length) {
        let consumed = false;
        const valid = () => !consumed && ws.docs.current[current.path]?.content === current.content;
        link = { valid, remove() {
          if (!valid()) return false;
          consumed = true;
          ws.change(current.path, current.content.slice(0, from) + current.content.slice(to));
          return true;
        } };
      }
    }
    if (!link) { notify('未找到附件链接，请重新选择。'); return; }
    setFormError('');
    setDialog({ kind: 'trash', path, link });
  };
  const exportDocument = async (kind: 'md' | 'html' | 'pdf') => {
    if (!activeDoc) return;
    if (!/\.(md|markdown)$/i.test(ws.active)) { notify('请打开 Markdown 文档。'); return; }
    try {
      editor.current?.flush();
      if (kind === 'md') {
        if (
          await api.exportFile(
            'md',
            ws.active,
            ws.docs.current[ws.active].content,
          )
        ) {
          notify('已导出 Markdown');
        }
        return;
      }
      const { documentHTML } = await import('./documentExport');
      const html = await documentHTML(ws.docs.current[ws.active].content, ws.active, displayName(ws.active));
      if (kind === 'pdf') {
        if (await api.exportPDF(ws.active, html)) notify('已导出 PDF');
        return;
      }
      if (await api.exportFile('html', ws.active, html)) {
        notify('已导出 HTML');
      }
    } catch (err) {
      notify((err as Error).message);
    }
  };
  const execute = (command: string) => {
    if (dialog && command !== 'save') return;
    editor.current?.flush();
    setMenu(null);
    switch (command) {
      case 'new':
        showNew('new');
        break;
      case 'folder':
        showNew('folder');
        break;
      case 'open':
        openWorkspace();
        break;
      case 'import':
        importDocuments();
        break;
      case 'save':
        if (binaryReadOnly) break;
        void safe(async () => {
          capture();
          await drawingEditor.current?.flush();
          await flushPreferences();
          if (!(await ws.save(ws.active))) throw new Error('请先处理当前文档保存错误或冲突。');
          notify(drawing ? '已保存绘图' : '已保存文档');
        });
        break;
      case 'export-md':
        void exportDocument('md');
        break;
      case 'export-html':
        void exportDocument('html');
        break;
      case 'export-pdf':
        void exportDocument('pdf');
        break;
      case 'search':
        setView('search');
        setSidebar(true);
        break;
      case 'mode':
        if (!/\.(md|markdown)$/i.test(ws.active)) break;
        editor.current?.flush();
        switchMode(mode === 'rich' ? 'source' : mode === 'source' ? 'read' : 'rich');
        break;
      case 'sidebar':
        setSidebar((previous) => !previous);
        break;
      case 'terminal': toggleTerminal(); break;
      case 'theme':
        setTheme((previous) => (previous === 'dark' ? 'light' : 'dark'));
        break;
      case 'updates': window.dispatchEvent(new Event('moyu-check-update')); break;
      case 'settings':
        setDialog({ kind: 'settings' });
        break;
      case 'shortcuts':
        setDialog({ kind: 'shortcuts' });
        break;
      case 'guide': {
        const guide = files.find((file) => /(?:markdown完全语法示例|Markdown 语法指南)\.md$/i.test(file.path));
        if (guide) void openDocument(guide.path);
        else notify('未找到语法指南');
        break;
      }
    }
  };
  const executeRef = useRef(execute);
  executeRef.current = execute;
  useEffect(() => api.onCommand((command) => executeRef.current(command)), []);
  useEffect(
    () =>
      api.onBeforeClose(() => {
        if(windowCloseTask.current)return;
        const task = (async () => {
          capture();
          await drawingEditor.current?.flush();
          await flushPreferences();
          if (await ws.prepareClose()) await api.confirmClose();
        })();
        windowCloseTask.current=task;
        void task.catch((e) => notify(e.message)).finally(()=>{windowCloseTask.current=null;});
      }),
    [ws.prepareClose],
  );
  useEffect(() => {
    const flush = () => editor.current?.flush();
    window.addEventListener('beforeunload', flush, true);
    return () => window.removeEventListener('beforeunload', flush, true);
  }, []);
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (isComposingKey(event)) return;
      if ((event.target as Element)?.closest('[role="dialog"]')) return;
      if ((event.target as Element)?.closest('.document-history-view')) return;
      if((event.ctrlKey||event.metaKey)&&event.code==='Backquote'){event.preventDefault();toggleTerminal();return;}
      if((event.target as Element)?.closest('.terminal-panel'))return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      // Native menu accelerators handle these keys on desktop.
      if (api.desktop && ['n', 'o', 's', 'e', 'b', 'f', 'z'].includes(key)) {
        return;
      }
      const command = key === 'n'
        ? 'new'
        : key === 'o'
        ? event.shiftKey
          ? 'import'
          : 'open'
        : key === 's'
        ? event.shiftKey
          ? 'export-md'
          : 'save'
        : key === 'e'
        ? 'mode'
        : key === 'b'
            && !event.shiftKey
            && !(event.target as HTMLElement).closest(
              '.ProseMirror, .cm-editor',
            )
        ? 'sidebar'
        : key === 'p' && event.altKey
        ? 'export-pdf'
        : key === 'f' && event.shiftKey
        ? 'search'
        : undefined;
      if (command) {
        event.preventDefault();
        executeRef.current(command);
      }
    };
    document.addEventListener('keydown', shortcuts, true);
    return () => document.removeEventListener('keydown', shortcuts, true);
  }, []);
  const doAction = (action: EditorAction) => {
    editor.current?.action(action);
    setMenu(null);
  };
  const showContext = (event: React.MouseEvent, node: FileNode) => {
    event.preventDefault();
    event.stopPropagation();
    if(node.system){
      setContext(null);
      setElementMenu({x:event.clientX,y:event.clientY,actions:[{label:'在文件管理器中显示',action:()=>void safe(()=>api.reveal(node.path))}]});
      return;
    }

    setContext({
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 270),
      node,
    });
  };
  const shortcutsList = [
    ['新建文档', 'N'],
    ['保存文档', 'S'],
    ['打开工作空间', 'O'],
    ['导入 Markdown', '⇧ O'],
    ['搜索工作空间', '⇧ F'],
    ['切换源码模式', 'E'],
    ['导出 PDF', 'Alt P'],
    ['加粗 / 斜体', 'B / I'],
    ['撤销', 'Z'],
  ];
  const mod = api.platform === 'darwin' ? '⌘' : 'Ctrl';
  const fileList = files.filter(file => favorites.includes(file.path));

  return (
    <div
      className={`app ${wide ? 'wide-document' : ''}`}
      style={{
        ...paletteStyle(appearance.preset, theme),
        ...appearanceStyle(appearance, fontSize, lineHeight),
        '--editor-line-height': lineHeight,
        ...(wide
          ? { '--document-width': Math.max(980, appearance.width) + 'px' }
          : {}),
      } as React.CSSProperties}
      onContextMenuCapture={createElementContextMenu({
        editor, ws: { active: ws.active, tabs: ws.tabs }, mode, files, markdownValue, codeRuns,
        safe, notify, closeDocuments, openDocument, showRename, showAttachmentTrash, imagePath,
        setRightbar, setRightTab, setDataReveal, createDrawing, setContext, setElementMenu,
      })}
      onClickCapture={(event) => {
        if (
          (event.target as HTMLElement).closest('.file-tree')
          && !(event.target as HTMLElement).closest('.tree-row')
        ) setTreeSelection('');
        if (!(event.target as HTMLElement).closest('.ProseMirror, .cm-editor')) {
          editor.current?.flush();
        }
      }}
    >
      <div className='workspace-layout'>
        {
          <nav className='activity-bar' aria-label='工具栏'>
            {[
              { id: 'files', title: '文件', icon: <Files size={21} /> },
              { id: 'search', title: '全文搜索', icon: <Search size={21} /> },
              { id: 'favorites', title: '收藏', icon: <Star size={21} /> },
              { id: 'history', title: '文档历史', icon: <History size={21} /> },
              { id: 'webdav', title: 'WebDAV 同步', icon: <Cloud size={21} /> },
              {
                id: 'drawings',
                title: 'Excalidraw 绘图',
                icon: <PencilLine size={21} />,
              },
            ].map((item) => (
              <IconButton
                key={item.id}
                title={item.title}
                active={sidebar && view === item.id}
                onClick={() => {
                  setSidebar(!(sidebar && view === item.id));
                  setView(item.id as View);
                  setHome(false);
                }}
              >
                {item.icon}
              </IconButton>
            ))}
            <div className='activity-spacer' />
            <IconButton title='切换主题' onClick={() => execute('theme')}>
              {theme === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
            </IconButton>
            <IconButton title='偏好设置' onClick={() => execute('settings')}>
              <Settings2 size={21} />
            </IconButton>
          </nav>
        }
        {sidebar && ws.workspace && (
          <aside className={'sidebar' + (view === 'files' ? ' file-sidebar' : '')}>
            <div className='sidebar-title'>
              {view === 'files' ? <button className='workspace-picker' onClick={openNavigation} title={ws.workspace.root} aria-label='知识库导航'>
                <FolderOpen size={16}/><span>{ws.workspace.name}</span><ChevronDown size={12}/>
              </button> : <span>
                {view === 'search'
                  ? '搜索'
                  : view === 'favorites'
                  ? '收藏'
                  : view === 'webdav'
                  ? '同步'
                  : view === 'drawings'
                  ? '绘图'
                  : '文档历史'}
              </span>}
              <div>
                {view === 'files' && (
                  <>
                    <IconButton
                      title={fileView === 'workspace' ? '查看当前文档附属目录' : '查看工作空间'}
                      active={fileView === 'document'}
                      onClick={() => { setSortMenu(null); setFileView(fileView === 'workspace' ? 'document' : 'workspace'); }}
                    ><FolderTree size={16} /></IconButton>
                    <IconButton
                      title='新建文档'
                      disabled={!ws.workspace || fileView === 'document' && !assets}
                      onClick={() => showNew('new')}
                    >
                      <Plus size={17} />
                    </IconButton>
                    <IconButton
                      title='新建文件夹'
                      disabled={fileView === 'document' && !assets}
                      onClick={() => showNew('folder')}
                    >
                      <FolderPlus size={16} />
                    </IconButton>
                  </>
                )}
                <IconButton title='收起侧栏' onClick={() => setSidebar(false)}>
                  <PanelLeftClose size={16} />
                </IconButton>
              </div>
            </div>
            {view === 'files' && <div className='file-explorer-controls'>
              <button className='explorer-sort-button' aria-label='文件排序' onClick={event => {
                const box = event.currentTarget.getBoundingClientRect();
                setSortMenu(sortMenu ? null : { x: box.left, y: box.bottom + 2 });
              }}>
                <ArrowDownUp size={14} /><span>{sortLabels[fileOrder[0].key]}</span>{fileOrder[0].descending ? <ArrowDown size={12}/> : <ArrowUp size={12}/>}<ChevronDown size={12} />
              </button>
              {fileView === 'workspace' && <IconButton title='显示附属文件夹与数据' onClick={() => setShowCompanions(!showCompanions)}>
                {showCompanions ? <Eye size={15} /> : <EyeOff size={15} />}
              </IconButton>}
              {fileView === 'document' && <span className='explorer-owner' title={assets?.companionFor || ws.active}>
                {assets?.companionFor?.split('/').pop() || ws.active.split('/').pop()}
              </span>}
            </div>}
            {view === 'history' ? <DocumentHistory key={(ws.workspace?.root || '')+ws.active} root={ws.workspace?.root || ''} document={ws.active} version={activeDoc?.version} content={activeDoc?.content || ''} readOnly={ws.workspace?.readOnly} flush={()=>editor.current?.flush()} restore={async id=>{editor.current?.flush();await ws.restoreHistory(ws.active,id);}}/> : view === 'webdav'
              ? (
                <WebDAVPanel
                  key={ws.workspace?.root}
                  root={ws.workspace?.root || ''}
                  beforeAction={beforeFeatureAction}
                  refresh={ws.refresh}
                  unsaved={Object.values(ws.documents).some(d => d.dirty)}
                  openSettings={() => setDialog({ kind: 'settings', category: 'WebDAV' })}
                />
              )
              : view === 'drawings'
              ? (
                <DrawingsPanel
                  active={ws.active}
                  showExtensions={appearance.showExtensions}
                  files={files}
                  open={(path) => void openDocument(path, true)}
                  keep={(path) => void openDocument(path)}
                  create={() => void safe(createDrawing)}
                />
              )
              : view === 'search'
              ? (
                <div className='search-panel'>
                  <div className='search-input'>
                    <Search size={15} />
                    <input
                      ref={searchInput}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder='搜索文件名和内容…'
                      aria-label='搜索文件名和内容'
                    />
                    {query && (
                      <button
                        aria-label='清空搜索'
                        onClick={() => setQuery('')}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <div className='search-meta'>
                    {searching
                      ? '正在搜索…'
                      : query
                      ? `${results.length} 篇匹配文档`
                      : '搜索文件名与正文'}
                  </div>
                  {results.map((result) => (
                    <button
                      key={result.path}
                      className='search-result'
                      onClick={event => {
                        const line = Number((event.target as Element).closest<HTMLElement>('[data-search-line]')?.dataset.searchLine)
                          || result.matches[0]?.line;
                        if (event.detail < 2) void openSearchResult(result.path, true, line);
                      }}
                      onDoubleClick={event => {
                        const line = Number((event.target as Element).closest<HTMLElement>('[data-search-line]')?.dataset.searchLine)
                          || result.matches[0]?.line;
                        void openSearchResult(result.path, false, line);
                      }}
                    >
                      <span>
                        <FileText size={15} />
                        <strong>{displayName(result.name)}</strong>
                      </span>
                      {result.matches.slice(0, 3).map((match) => (
                        <small key={match.line} data-search-line={match.line}>
                          <span>{match.line}</span>
                          {match.text}
                        </small>
                      ))}
                      <em>{folderOf(result.path) || '工作空间'}</em>
                    </button>
                  ))}
                  {query && !searching && !results.length && (
                    <div className='small-empty'>
                      <Search size={24} />
                      <p>还没有找到这段文字</p>
                      <span>换个关键词再试试</span>
                    </div>
                  )}
                </div>
              )
              : view === 'files'
              ? (
                <div className='sidebar-scroll'>
                  <FileTree
                    nodes={fileNodes}
                    creation={fileCreation || undefined}
                    draft={fileCreation && <FileNameInput key={fileCreation.kind+":"+fileCreation.parent} folder={fileCreation.kind==='folder'} document={fileCreation.kind==='new'} create={createInline} cancel={()=>setFileCreation(null)} />}
                    baseFolder={fileView === 'document' ? assets?.path : ''}
                    active={treeSelection}
                    expanded={expanded}
                    selectedFolder={selectedFolder}
                    toggle={(path) => {
                      setSelectedFolder(path);
                      setTreeSelection(previous => previous === path ? '' : path);
                      setExpanded((previous) => {
                        const next = new Set(previous);
                        next.has(path) ? next.delete(path) : next.add(path);
                        return next;
                      });
                    }}
                    open={(path) => void openDocument(path, true)}
                    keep={(path) => void openDocument(path)}
                    move={moveFile}
                    clipboardAction={clipboardAction}
                    context={showContext}
                    showExtensions={appearance.showExtensions}
                    dirtyPaths={new Set(
                      Object.values(ws.documents).filter(doc => doc.dirty).map(doc => doc.path),
                    )}
                    statuses={Object.fromEntries(
                      files.map(
                        f => [
                          f.path,
                          syncPhase === 'syncing' && syncFiles[f.path]
                            && !['unconfigured', 'excluded', 'conflict'].includes(syncFiles[f.path])
                            ? 'syncing'
                            : syncPhase === 'error' && syncFiles[f.path]
                                && !['unconfigured', 'excluded', 'conflict'].includes(syncFiles[f.path])
                            ? 'error'
                            : syncFiles[f.path] || 'unconfigured',
                        ],
                      ),
                    )}
                  />
                  {fileView === 'document' && !assets && <div className='empty-side'><span>此文档暂无附属目录</span></div>}
                  {!files.length && ws.ready && (
                    <div className='small-empty'>
                      <FileText size={25} />
                      <p>这里还是一片空白</p>
                      <button
                        className='text-button'
                        onClick={() => showNew('new')}
                      >
                        创建第一篇文档 <Plus size={13} />
                      </button>
                    </div>
                  )}
                </div>
              )
              : (
                <div className='sidebar-scroll'>
                  <div className='section-label'>
                    <span>收藏文档</span>
                    <span>{fileList.length}</span>
                  </div>
                  {fileList.map((file) => (
                    <button
                      key={file.path}
                      className={`flat-file ${ws.active === file.path ? 'selected' : ''}`}
                      onClick={event => {
                        if (event.detail < 2) void openDocument(file.path, true);
                      }}
                      onDoubleClick={() => void openDocument(file.path)}
                    >
                      <FileText size={16} />
                      <div>
                        <span>{displayName(file.name, appearance.showExtensions)}</span>
                        <small>{folderOf(file.path) || '工作空间'}</small>
                      </div>
                      {view === 'favorites' && <Star size={12} className='filled-star' />}
                    </button>
                  ))}
                  {!fileList.length && (
                    <div className='small-empty'>
                      <Star size={26} />
                      <p>暂无收藏</p>
                      <span>在文档右上角点击收藏</span>
                    </div>
                  )}
                </div>
              )}
          </aside>
        )}
        {sidebar && ws.workspace && (
          <SidebarDivider
            width={appearance.sidebarWidth}
            change={width => setAppearance(previous => ({ ...previous, sidebarWidth: width }))}
          />
        )}
        <div className='editor-workspace'>
          <div
            className={`tabbar ${api.platform === 'darwin' ? 'mac-tabbar' : ''}`}
          >
            <div className='file-navigation'>
              <IconButton
                title='后退'
                disabled={!fileHistory.back}
                onClick={() => void safe(() => fileHistory.move(-1))}
              >
                <ArrowLeft size={15} />
              </IconButton>
              <IconButton
                title='前进'
                disabled={!fileHistory.forward}
                onClick={() => void safe(() => fileHistory.move(1))}
              >
                <ArrowRight size={15} />
              </IconButton>
            </div>
            {!sidebar && (
              <IconButton
                title='展开侧栏'
                onClick={() => setSidebar(true)}
              >
                <Menu size={17} />
              </IconButton>
            )}
            <div className='tabs'>
              {ws.tabs.map((path) => (
                <div
                  key={path}
                  className={`tab ${ws.active === path ? 'active' : ''} ${
                    ws.previewTab === path ? 'preview' : ''
                  }`}
                  onDoubleClick={() => ws.pin(path)}
                >
                  <button
                    className='tab-name'
                    title={path}
                    onClick={() => void openDocument(path, path === ws.previewTab)}
                  >
                    <FileIcon path={path} />
                    <span>{displayName(path, appearance.showExtensions)}</span>
                    {ws.documents[path]?.dirty && <span className='dirty-dot' />}
                  </button>
                  <button
                    className='tab-close'
                    title='关闭文档'
                    aria-label={`关闭 ${displayName(path)}`}
                    onClick={() => void safe(() => closeDocuments([path]))}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
            <div className='tabbar-spacer' />
            {/\.(md|markdown)$/i.test(ws.active) && <IconButton
              title={rightbar ? '隐藏文档信息' : '显示文档信息'}
              active={rightbar}
              onClick={() => {
                setRightbar((previous) => !previous);
                setRightTab('outline');
              }}
            >
              <PanelRightClose size={17} />
            </IconButton>}
            {api.desktop && api.platform !== 'darwin' && (
              <>
              <div className='window-drag-space' aria-hidden='true' />
              <div className='window-controls'>
                <button
                  aria-label='最小化窗口'
                  onClick={() => void api.windowControl('minimize')}
                >
                  <Minus size={15} />
                </button>
                <button
                  aria-label='最大化窗口'
                  onClick={() => void api.windowControl('maximize')}
                >
                  <Square size={12} />
                </button>
                <button
                  className='window-close'
                  aria-label='关闭窗口'
                  onClick={() => void api.windowControl('close')}
                >
                  <X size={17} />
                </button>
              </div>
              </>
            )}
          </div>
          <div className={'editor-terminal-layout '+terminalDirection} style={{'--terminal-size':terminalSizes[terminalDirection]+'px'} as import('react').CSSProperties}><main className='main-area'>
            <DocumentBoundary key={(ws.workspace?.root||'')+ws.active+ws.editorEpoch} retry={()=>ws.setEditorEpoch(epoch=>epoch+1)} close={()=>void safe(()=>closeDocuments([ws.active]))}>
            {!ws.workspace
              ? <Navigation current={null} before={beforeWorkspaceChange} opened={enterWorkspace} onDeleted={()=>{ws.leaveWorkspace();setHome(false);}} />
              : drawing
              ? (
                <Suspense
                  fallback={<div className='editor-loading'>正在打开画布…</div>}
                >
                  <DrawingEditor
                    key={drawing.path + ws.editorEpoch}
                    root={ws.workspace!.root}
                    readOnly={ws.workspace?.readOnly}
                    ref={drawingEditor}
                    document={drawing}
                    notePath={notePath}
                    theme={theme}
                    onChange={content => ws.change(drawing.path, content)}
                    save={() => ws.save(drawing.path)}
                    onRename={async name => {
                      const folder = drawing.path.split('/').slice(0, -1).join('/');
                      const target = (folder ? folder + '/' : '') + name;
                      if (target !== drawing.path) await ws.rename(drawing.path, target);
                    }}
                    resolve={action => ws.resolveConflict(drawing.path, action)}
                    onCopy={async path => {
                      try {
                        await ws.reload(drawing.path);
                      } catch {
                        ws.discardTab(drawing.path);
                      }
                      await ws.open(path);
                      await ws.refresh();
                    }}
                    notify={notify}
                    onInsert={insertDrawing}
                    onClose={() => void safe(closeDrawing)}
                  />
                </Suspense>
              )
              : activeDoc && isImage(ws.active)
              ? <ImageViewer key={ws.active} path={ws.active} onClose={() => void safe(() => closeDocuments([ws.active]))} />
              : activeDoc && ['pdf','sqlite','html','text'].includes(fileKind(ws.active))
              ? <Suspense fallback={<div className='editor-loading'>正在打开文件…</div>}>
                  {fileKind(ws.active)==='pdf' ? <PdfViewer key={ws.active+activeDoc.version} path={ws.active} onClose={() => void safe(() => closeDocuments([ws.active]))}/>
                    : fileKind(ws.active)==='sqlite' ? <SqliteViewer key={ws.active+activeDoc.version} path={ws.active} onClose={() => void safe(() => closeDocuments([ws.active]))}/>
                    : fileKind(ws.active)==='html' ? <HTMLFileViewer key={(ws.workspace?.root||'')+ws.active+ws.editorEpoch} root={ws.workspace?.root} path={ws.active} readOnly={ws.workspace?.readOnly} value={activeDoc.content} editor={editor} onChange={content=>ws.change(ws.active,content)} onError={notify} theme={theme} fontSize={fontSize} selection={restoredSelection} onClose={() => void safe(() => closeDocuments([ws.active]))}/>
                    : <div className='text-file-container'>
                        <div className='document-toolbar'><div className='breadcrumbs'><IconButton title='关闭当前文档' onClick={() => void safe(() => closeDocuments([ws.active]))}><X size={16}/></IconButton><Folder size={14}/><span>{folderOf(ws.active)||'工作空间'}</span><ChevronRight size={13}/><strong>{displayName(ws.active,appearance.showExtensions)}</strong></div></div>
                        {activeDoc.conflict&&<div className='conflict-banner'><AlertCircle size={16}/><span>这个文件在其他程序中发生了变更</span><button onClick={()=>setConflictDismissed('')}>比较并处理</button></div>}
                        <TextFileEditor key={ws.active+ws.editorEpoch} ref={editor} path={ws.active} value={activeDoc.content}
                          onChange={content=>ws.change(ws.active,content)} onError={notify} theme={theme} fontSize={fontSize}
                          readOnly={!!ws.workspace?.readOnly||files.some(f=>f.path===ws.active&&f.system)} selection={restoredSelection}/>
                      </div>}
                </Suspense>
              : activeDoc
              ? (
                <>
                  <div className='document-toolbar'>
                    <div className='breadcrumbs'>
                      <IconButton title='关闭当前文档' onClick={() => void safe(() => closeDocuments([ws.active]))}><X size={16} /></IconButton>
                      <Folder size={14} />
                      <span>{folderOf(ws.active) || '工作空间'}</span>
                      <ChevronRight size={13} />
                      <strong>{displayName(ws.active, appearance.showExtensions)}</strong>
                    </div>
                    <div className='document-actions'>
                      <div className='mode-switch'>
                        <button
                          className={mode === 'rich' ? 'selected' : ''}
                          disabled={!/\.(md|markdown)$/i.test(ws.active)}
                          onClick={() => {
                            switchMode('rich');
                          }}
                        >
                          <PencilLine size={13} />
                          预览编辑
                        </button>
                        <button
                          className={mode === 'source' ? 'selected' : ''}
                          onClick={() => {
                            switchMode('source');
                          }}
                        >
                          <Code2 size={14} />
                          源码
                        </button>
                        <button
                          disabled={!/\.(md|markdown)$/i.test(ws.active)}
                          className={mode === 'read' ? 'selected' : ''}
                          onClick={() => {
                            switchMode('read');
                          }}
                        >
                          <BookOpen size={14} />阅读
                        </button>
                      </div>
                      <span className='toolbar-divider' />
                      <IconButton
                        title={favorites.includes(ws.active) ? '取消收藏' : '收藏文档'}
                        active={favorites.includes(ws.active)}
                        onClick={() => toggleFavorite(ws.active)}
                      >
                        <Star
                          size={17}
                          className={favorites.includes(ws.active) ? 'filled-star' : ''}
                        />
                      </IconButton>
                      <IconButton
                        title={formatbar ? '隐藏格式工具栏' : '显示格式工具栏'}
                        active={formatbar}
                        onClick={() => setFormatbar((previous) => !previous)}
                      >
                        <Type size={17} />
                      </IconButton>
                      <div className='popover-anchor'>
                        <IconButton
                          title='更多文档操作'
                          onClick={() =>
                            setMenu((previous) => previous === 'document' ? null : 'document')}
                        >
                          <MoreHorizontal size={19} />
                        </IconButton>
                        {menu === 'document' && (
                          <div className='popover-menu document-menu'>
                            <button onClick={() => execute('import')}>
                              <Upload size={15} />
                              导入 Markdown
                            </button>
                            <button onClick={() => execute('open')}>
                              <FolderOpen size={15} />
                              打开文件夹
                            </button>
                            <hr />
                            <button onClick={() => showRename(ws.active)}>
                              <PencilLine size={15} />
                              重命名文档
                            </button>
                            <button
                              onClick={() => void exportDocument('md')}
                            >
                              <Download size={15} />
                              导出 Markdown
                            </button>
                            <button onClick={() => void exportDocument('html')}>
                              <Code2 size={15} />
                              导出 HTML
                            </button>
                            <button onClick={() => void exportDocument('pdf')}>
                              <FileText size={15} />
                              导出 PDF
                            </button>
                            <hr />
                            <button
                              onClick={() => void safe(() => api.reveal(ws.active))}
                            >
                              <FolderOpen size={15} />
                              在文件管理器中显示
                            </button>
                            <button
                              className='danger'
                              onClick={() => {
                                setDialog({ kind: 'trash', path: ws.active });
                                setFormError('');
                              }}
                            >
                              <Trash2 size={15} />
                              移至回收站
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {formatbar && mode !== 'read' && (
                    <FormattingToolbar menu={menu} setMenu={setMenu} doAction={doAction} drawingAllowed={drawingAllowed} onDrawing={() => void safe(() => createDrawing(true))}/>
                  )}
                  {activeDoc.conflict && (
                    <div className='conflict-banner'>
                      <AlertCircle size={16} />
                      <span>这个文件在其他程序中发生了变更</span>
                      <button onClick={() => setConflictDismissed('')}>
                        比较并处理
                      </button>
                    </div>
                  )}
                  <div
                    className='document-scroll'
                    onClickCapture={(event) => {
                      const anchor = (event.target as HTMLElement).closest('a');
                      const href = anchor?.getAttribute('href');
                      if (!href) return;
                      if (mode === 'rich') {
                        event.preventDefault();
                        // Inline source views handle Ctrl+mousedown themselves.
                        // Ordinary clicks only reveal Markdown, never navigate.
                        if (anchor?.closest('[data-inline-source],.syntax-preview') || !event.ctrlKey && !event.metaKey) return;
                      }
                      if (mode === 'source') {
                        event.preventDefault();
                        return;
                      }
                      if (!/^([a-z][\w+.-]*:|\/|#)/i.test(href)) {
                        event.preventDefault();
                        event.stopPropagation();
                        const path = anchor?.dataset.wiki === 'true'
                          ? wikiPath(ws.active, href, files)
                          : relativeLink(ws.active, href);
                        if (path) void openDocument(path);
                      } else if (/^(https?:|mailto:)/i.test(href)) {
                        event.preventDefault();
                        void api.openExternal(href);
                      }
                    }}
                  >
                    <Suspense
                      fallback={
                        <div className='editor-loading'>
                          <LoaderCircle size={20} className='spin' />
                          正在加载编辑器…
                        </div>
                      }
                    >
                      {mode === 'read'||ws.workspace?.readOnly&&mode==='rich'
                        ? (
                          <ReadingView
                            key={ws.active}
                            path={ws.active}
                            value={activeDoc.content}
                            scrollTop={scrollPositions.current.get(ws.active + '\0read')
                              ?? currentSelection?.scrollTop ?? 0}
                          />
                        )
                        : mode === 'rich'
                        ? (
                          <WysiwygEditor
                            root={ws.workspace?.root}
                            key={`${ws.active}-${ws.editorEpoch}`}
                            ref={editor}
                            path={ws.active}
                            selection={restoredSelection}
                            value={activeDoc.content}
                            savedValue={activeDoc.savedContent}
                            onChange={(content) => ws.change(ws.active, content)}
                            onError={notify}
                            theme={theme}
                            fontSize={fontSize}
                            onDrawing={() => void safe(() => createDrawing(true))}
                            onDrawingAllowed={setDrawingAllowed}
                          />
                        )
                        : (
                          <SourceEditor
                            root={ws.workspace?.root}
                            readOnly={!!ws.workspace?.readOnly||files.some(f=>f.path===ws.active&&f.system)||!/\.(md|markdown)$/i.test(ws.active)}
                            key={`${ws.active}-${ws.editorEpoch}`}
                            ref={editor}
                            path={ws.active}
                            selection={restoredSelection}
                            value={activeDoc.content}
                            onChange={(content) => ws.change(ws.active, content)}
                            onError={notify}
                            theme={theme}
                            fontSize={fontSize}
                          />
                        )}
                    </Suspense>
                    {mode !== 'source' && !ws.workspace?.readOnly && (
                      <InlineCodeLayer
                        key={ws.workspace?.root + '-' + ws.active + '-' + mode}
                        path={ws.active}
                        mode={mode}
                        editor={editor}
                        runs={codeRuns}
                      />
                    )}
                  </div>
                </>
              )
              : (
                <div className='empty-editor'>
                  <Logo size={58} />
                  <h1>打开或新建文档</h1>
                  <p>
                    {ws.ready
                      ? '打开或新建文档。'
                      : '正在打开知识库…'}
                  </p>
                  <button className='primary-button' onClick={() => showNew('new')}>
                    <Plus size={17} />
                    新建文档
                  </button>
                  <button className='text-button' onClick={openWorkspace}>
                    <FolderOpen size={16} />
                    打开本地文件夹
                  </button>
                  <div className='empty-shortcuts'>
                    <kbd>{mod} N</kbd> 新建文档
                  </div>
                </div>
              )}
            </DocumentBoundary>
          </main>{terminalVisible&&<TerminalDivider direction={terminalDirection} size={terminalSizes[terminalDirection]} change={size=>setTerminalSizes(v=>({...v,[terminalDirection]:size}))}/>}
          {terminalMounted&&<Suspense fallback={null}><TerminalPanel root={ws.workspace?.root||''} visible={terminalVisible} direction={terminalDirection} themeKey={theme+appearance.preset+appearance.accent} count={setTerminalCount} hide={()=>setTerminalVisible(false)} rotate={()=>setTerminalDirection(v=>v==='below'?'right':'below')}/></Suspense>}</div>
          {rightbar && activeDoc && !drawing && /\.(md|markdown)$/i.test(ws.active) && (
            <aside className='right-sidebar'>
              <SidebarDivider side='right' width={appearance.infoWidth} change={width=>setAppearance(previous=>({...previous,infoWidth:width}))}/>
              <div className='right-tabs' role='tablist' aria-label='文档信息'>
                <button
                  role='tab'
                  title='大纲'
                  aria-label='大纲'
                  aria-selected={rightTab === 'outline'}
                  onClick={() => setRightTab('outline')}
                >
                  <List size={15} />
                  <span className='right-tab-label'>大纲</span>
                </button>
                <button
                  role='tab'
                  title='附件'
                  aria-label='附件'
                  aria-selected={rightTab === 'attachments'}
                  onClick={() => setRightTab('attachments')}
                >
                  <Paperclip size={15} />
                  <span className='right-tab-label'>附件</span>
                </button>
                <button
                  role='tab'
                  title='数据'
                  aria-label='数据'
                  aria-selected={rightTab === 'data'}
                  onClick={() => setRightTab('data')}
                >
                  <Folder size={15} />
                  <span className='right-tab-label'>数据</span>
                </button>
              </div>
              <div className='right-scroll'>
                {rightTab === 'data'
                  ? (
                    <DataPanel
                      key={ws.workspace?.root + '-' + ws.active}
                      root={ws.workspace?.root || ''}
                      document={ws.active}
                      content={markdownValue}
                      files={files}
                      open={openDocument}
                      refresh={ws.refresh}
                      trash={removeFile}
                      ensureIds={()=>{const value=editor.current?.ensureCodeIds?.()||normalizeCodeIds(ws.workspace?.root,ws.active,markdownValue).content;ws.change(ws.active,value);return value;}}
                      scopes={codeRuns.scopes}
                      revealKey={dataReveal.key}
                      revealRequest={dataReveal.request}
                      locate={id => {
                        if (mode === 'read') {
                          const block = [...document.querySelectorAll<HTMLElement>(
                            '.reading-view .code-block-shell',
                          )].find(el=>codeId(el.dataset.codeMeta||'')===id);
                          if (block) {
                            block.scrollIntoView({ block: 'center' });
                            block.tabIndex = -1;
                            block.focus({ preventScroll: true });
                          }
                        } else editor.current?.scrollToCode?.(id);
                      }}
                    />
                  )
                  : rightTab === 'attachments'
                  ? (
                    <AttachmentsPanel
                      key={ws.workspace?.root + '-' + ws.active}
                      root={ws.workspace?.root || ''}
                      document={ws.active}
                      content={markdownValue}
                      files={files}
                      open={openDocument}
                      refresh={ws.refresh}
                      editable={mode !== 'read' && !files.some(f=>f.path===ws.active&&f.system) && /\.(md|markdown)$/i.test(ws.active)}
                      trash={removeFile}
                      insert={text => editor.current?.insert(text)}
                      locate={(path,offset)=>{
                        if(mode!=='read'){editor.current?.scrollToOffset?.(offset);return;}
                        const target=[...document.querySelectorAll<HTMLElement>('.reading-view [data-resource-link],.reading-view a[href],.reading-view img[src]')].find(el=>resourcePath(ws.active,el.dataset.resourceLink||el.getAttribute('href')||el.getAttribute('src')||'')===path);
                        if(target){target.scrollIntoView({block:'center'});target.tabIndex=-1;target.focus({preventScroll:true});}
                      }}
                    />
                  )
                  : (
                    <>
                      <DocumentOutline key={(ws.workspace?.root||'')+ws.active} headings={headings} mode={mode} editor={editor} navigate={(index)=>{
                        if(mode==='read'){const heading=document.querySelectorAll<HTMLElement>('.reading-view h1,.reading-view h2,.reading-view h3,.reading-view h4,.reading-view h5,.reading-view h6')[index];if(!heading)return false;heading.scrollIntoView({behavior:'smooth',block:'start'});return true;}
                        if(!editor.current||!document.querySelector(mode==='source'?'.source-editor .cm-editor':'.editor-host .ProseMirror'))return false;
                        editor.current.scrollToHeading(index);return true;
                      }}/>
                    </>
                  )}
              </div>
            </aside>
          )}
        </div>
      </div>
      <footer className='statusbar'>
        <button
          className={`save-status ${activeDoc?.error ? 'error' : ''}`}
          disabled={binaryReadOnly}
          title={activeDoc?.error || '保存当前文档'}
          onClick={() => activeDoc && executeRef.current('save')}
        >
          {activeDoc?.saving
            ? <LoaderCircle size={12} className='spin' />
            : activeDoc?.error
            ? <AlertCircle size={12} />
            : (
              <span
                className={`status-dot ${activeDoc?.dirty ? 'unsaved' : ''}`}
              />
            )}
          <span>
            {activeDoc?.saving
              ? '正在保存…'
              : activeDoc?.conflict
              ? '本地文件冲突'
              : activeDoc?.error
              ? '保存失败，点击重试'
              : activeDoc?.dirty
              ? '本地未保存'
              : ['pdf','sqlite','image'].includes(fileKind(ws.active)) ? '只读' : '已保存到本地'}
          </span>
        </button>
        <span className='status-divider' />
        <button
          title='在偏好设置中修改保存方式'
          onClick={() => setDialog({ kind: 'settings' })}
        >
          {ws.savePolicy === 'manual' ? <Circle size={11} /> : <CheckCheck size={12} />}
          {{ manual: '手动保存', close: '离开时保存', realtime: '实时保存' }[ws.savePolicy]}
        </button>
        <div className='status-spacer' />
        {activeDoc && /\.(md|markdown)$/i.test(ws.active) && (
          <>
            <span>{currentWords.toLocaleString()} 字</span>
          </>
        )}
        {api.desktop&&<button className={'terminal-toggle icon-button '+(terminalVisible?'visible':terminalCount?'hidden-session':'closed')} data-terminal-state={terminalVisible?'visible':terminalCount?'hidden':'closed'} title={terminalVisible?'隐藏终端':terminalCount?'显示终端':'打开终端'} aria-label={terminalVisible?'隐藏终端':terminalCount?'显示终端':'打开终端'} onClick={toggleTerminal}><TerminalSquare size={15}/>{terminalCount>0&&!terminalVisible&&<span className='terminal-hidden-mark' aria-hidden='true'>−</span>}</button>}
        <IconButton title='快捷键' onClick={() => execute('shortcuts')}>
          <Keyboard size={13} />
        </IconButton>
      </footer>
      {toast && (
        <div className='toast' role='status'>
          <Check size={16} />
          <span>{toast}</span>
          <button aria-label='关闭提示' onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {elementMenu && <ElementMenu {...elementMenu} close={() => setElementMenu(null)} />}
      {sortMenu && <ExplorerSortMenu {...sortMenu} order={fileOrder} change={setFileOrder} close={() => setSortMenu(null)} />}
      {context && (
        <div
          className='popover-menu context-menu'
          ref={fileMenuElement}
          style={{ left: context.x, top: context.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {context.node.kind === 'folder'
            ? (
              <>
                <button
                  onClick={() => {
                    showNew('new', context.node.path);
                    setContext(null);
                  }}
                >
                  <Plus size={15} />
                  在这里新建文档
                </button>
                <button
                  onClick={() => {
                    showNew('folder', context.node.path);
                    setContext(null);
                  }}
                >
                  <FolderPlus size={15} />
                  新建子文件夹
                </button>
              </>
            )
            : (
              <button
                onClick={() => {
                  toggleFavorite(context.node.path);
                  setContext(null);
                }}
              >
                <Star size={15} />
                {favorites.includes(context.node.path) ? '取消收藏' : '收藏文档'}
              </button>
            )}
          <button disabled={!!context.node.companionFor} onClick={()=>{clipboardAction('cut',context.node.path,'');setContext(null);}}>剪切</button>
          <button disabled={!!context.node.companionFor} onClick={()=>{clipboardAction('copy',context.node.path,'');setContext(null);}}>复制</button>
          <button disabled={!fileClipboard.current} onClick={()=>{clipboardAction('paste',context.node.path,context.node.path.split('/').slice(0,-1).join('/'));setContext(null);}}>粘贴</button>
          <button
            onClick={() => {
              showRename(context.node.path);
              setContext(null);
            }}
            disabled={!!context.node.companionFor}
          >
            <PencilLine size={15} />
            重命名
          </button>
          <button
            onClick={() => {
              void safe(() => api.reveal(context.node.path));
              setContext(null);
            }}
          >
            <FolderOpen size={15} />
            在文件管理器中显示
          </button>
          <hr />
          <button
            className='danger'
            disabled={!!context.node.companionFor}
            onClick={() => {
              setDialog({ kind: 'trash', path: context.node.path });
              setFormError('');
              setContext(null);
            }}
          >
            <Trash2 size={15} />
            移至回收站
          </button>
        </div>
      )}
      {home && ws.workspace && (
        <Modal title='知识库' wide onClose={closeNavigation}>
          <Navigation
            compact
            current={ws.workspace}
            before={beforeWorkspaceChange}
            opened={enterWorkspace}
            onDeleted={()=>{ws.leaveWorkspace();selections.current.clear();setHome(false);}}
            onResume={closeNavigation}
          />
        </Modal>
      )}
      {dialog?.kind === 'rename' && <Modal title='重命名' onClose={closeDialog}>
        <form onSubmit={createOrRename}>
          <label className='form-label'>名称<input autoFocus value={formName} onChange={event=>setFormName(event.target.value)} aria-label='名称'/></label>
          <label className='form-label'>位置<select value={formFolder} onChange={event=>setFormFolder(event.target.value)}><option value=''>工作空间根目录</option>{folders.filter(folder=>folder.path!==dialog.path&&!folder.path.startsWith(dialog.path+'/')).map(folder=><option key={folder.path} value={folder.path}>{folder.path}</option>)}</select></label>
          {formError&&<p className='form-error' role='alert'>{formError}</p>}
          <div className='modal-footer'><button type='button' className='secondary-button' disabled={busy} onClick={closeDialog}>取消</button><button type='submit' className='primary-button' disabled={busy||!formName.trim()}>{busy?<LoaderCircle className='spin' size={15}/>:<Check size={15}/>}保存名称</button></div>
        </form>
      </Modal>}
      {!!orphans.length&&<Modal title='未关联的附属目录' onClose={()=>setOrphans([])}><div className='orphan-folders'>{orphans.map(orphan=><section key={orphan.document}><h4>{orphan.directory}</h4><p>原文档：{orphan.document}</p><select aria-label={'关联文档 '+orphan.document} defaultValue='' disabled={busy} onChange={event=>{const target=event.target.value;if(target)void safe(async()=>{const result=await api.feature<{documents:DiskDocument[];buffers:{original:string;path:string;content:string}[]}>('file.associate',{document:orphan.document,target});ws.applyFiles(result);await ws.refresh();setOrphans(await api.feature('file.orphans'));});}}><option value=''>关联匹配的文档</option>{orphan.candidates.map(candidate=><option key={candidate} value={candidate}>{candidate}</option>)}</select>{!orphan.candidates.length&&<small>没有匹配的文档。</small>}<button className='text-button danger' disabled={busy} onClick={()=>void safe(async()=>{if(!window.confirm('将 '+orphan.directory+' 移至回收站？'))return;const result=await api.feature<{cancelled?:boolean;documents:DiskDocument[];buffers:{original:string;path:string;content:string}[]}>('file.orphan-delete',orphan);if(result.cancelled)return;ws.applyFiles(result);await ws.refresh();setOrphans(await api.feature('file.orphans'));})}>移至回收站</button></section>)}</div><div className='modal-footer'><button className='secondary-button' onClick={()=>setOrphans([])}>暂不处理</button></div></Modal>}
      {dialog?.kind === 'trash' && (
        <Modal title='移至回收站？' onClose={closeDialog}>
          <p className='modal-description'>
            “{displayName(dialog.path)}”
            {folders.some((folder) => folder.path === dialog.path)
              ? '及其中的所有文件'
              : ''}
            将移至
            {api.desktop
              ? '系统回收站。'
              : '浏览器恢复副本。'}
          </p>
          {formError && <p className='form-error'>{formError}</p>}
          <div className='modal-footer'>
            <button
              className='secondary-button'
              onClick={closeDialog}
              disabled={busy}
            >
              取消
            </button>
            <button
              className='danger-button'
              onClick={() => void trash(dialog.path, dialog.link)}
              disabled={busy}
            >
              {busy ? <LoaderCircle size={15} className='spin' /> : <Trash2 size={15} />}
              移至回收站
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === 'settings' && (
        <Modal title='偏好设置' onClose={closeDialog}>
          <Preferences
            root={ws.workspace?.root}
            initialCategory={dialog.category}
            value={appearance}
            change={setAppearance}
            theme={theme}
            setTheme={setTheme}
            fontSize={fontSize}
            setFontSize={setFontSize}
            lineHeight={lineHeight}
            setLineHeight={setLineHeight}
            formatbar={formatbar}
            setFormatbar={setFormatbar}
            savePolicy={ws.savePolicy}
            saveDelay={ws.saveDelay}
            setSaveDelay={ws.setSaveDelay}
            setSavePolicy={ws.setSavePolicy}
            wide={wide}
            setWide={setWide}
          />
        </Modal>
      )}
      {dialog?.kind === 'shortcuts' && (
        <Modal title='快捷键' onClose={closeDialog}>
          <p className='modal-description'>常用操作</p>
          <div className='shortcut-list'>
            {shortcutsList.map(([label, key]) => (
              <div key={label}>
                <span>{label}</span>
                <kbd>
                  {mod} {key}
                </kbd>
              </div>
            ))}
          </div>
          <div className='shortcut-note'>
            输入 <kbd>/</kbd> 插入内容
          </div>
        </Modal>
      )}
      {!drawing && activeDoc?.conflict && conflictDismissed !== ws.active && (
        <Modal
          title='保留哪个版本？'
          wide
          onClose={() => setConflictDismissed(ws.active)}
        >
          <p className='modal-description'>
            文件被其他程序修改了。选择磁盘版本会替换当前编辑内容；保留当前内容会覆盖磁盘文件，并先备份磁盘版本。
          </p>
          <ConflictComparison left={activeDoc.content} right={activeDoc.conflict.content} labels={['当前编辑内容','磁盘中的内容']}/>
          <div className='modal-footer'>
            <button
              className='secondary-button'
              onClick={() => void safe(() => ws.resolveConflict(ws.active, 'disk'))}
            >
              使用磁盘版本
            </button>
            <button
              className='primary-button'
              onClick={() => void safe(() => ws.resolveConflict(ws.active, 'mine'))}
            >
              保留当前内容
            </button>
          </div>
        </Modal>
      )}
      <AppUpdates ready={ws.ready} />
    </div>
  );
}
