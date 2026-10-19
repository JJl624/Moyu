export interface FileNode {
  path: string;
  name: string;
  kind: "file" | "folder";
  children?: FileNode[];
  updated?: number;
  created?: number;
  companionFor?: string;
  size?: number;
  sync?: string;
  system?: boolean;
}
export interface Workspace {
  warnings?: string[];
  readOnly?: boolean;
  root: string;
  name: string;
  tree: FileNode[];
}
export interface DiskDocument {
  historyWarning?: string;
  path: string;
  content: string;
  version: string;
  updated: number;
}
export interface OpenDocument extends DiskDocument {
  savedContent: string;
  dirty: boolean;
  saving: boolean;
  error?: string;
  conflict?: DiskDocument;
}
export interface SearchResult {
  path: string;
  name: string;
  matches: { text: string; line: number }[];
}
export interface DesktopAPI {
  updateState(): Promise<import('./AppUpdates').UpdateState>;
  checkUpdate(manual?: boolean): Promise<import('./AppUpdates').UpdateState>;
  configureUpdate(automatic: boolean): Promise<import('./AppUpdates').UpdateState>;
  feature<T>(action: string, input?: unknown): Promise<T>;
  desktop: boolean;
  platform: string;
  load(): Promise<Workspace | null>;
  openVault(): Promise<Workspace | null>;
  list(): Promise<Workspace>;
  read(path: string): Promise<DiskDocument>;
  save(path: string, content: string, version: string, root?: string): Promise<DiskDocument>;
  create(
    path: string,
    kind: "file" | "folder",
    content?: string,
  ): Promise<DiskDocument>;
  rename(from: string, to: string): Promise<{ path: string }>;
  trash(path: string): Promise<Workspace>;
  search(query: string): Promise<SearchResult[]>;
  importFiles(): Promise<string[]>;
  exportFile(
    kind: "md" | "html",
    name: string,
    content: string,
  ): Promise<boolean>;
  exportPDF(name: string, html: string): Promise<boolean>;
  upload(document: string, name: string, bytes: Uint8Array): Promise<string>;
  assetData(path: string): Promise<string>;
  reveal(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  windowControl(action: "minimize" | "maximize" | "close"): Promise<void>;
  onScanError?(callback: (error: string) => void): () => void;
  onChange(callback: (workspace: Workspace) => void): () => void;
  onSync?(callback: (status: import('./webdavTypes').SyncJob) => void): () => void;
  onDownload?(callback: (status: import('./DownloadProgress').DownloadState) => void): () => void;
  onTerminal?(callback:(event:{type:'data'|'exit';id:string;data?:string;offset?:number;exitCode?:number})=>void):()=>void;
  onCommand(callback: (command: string) => void): () => void;
  onBeforeClose(callback: () => void): () => void;
  confirmClose(): Promise<void>;
}
declare global {
  interface Window {
    moyu?: DesktopAPI;
  }
}
export const flatten = (nodes: FileNode[]): FileNode[] =>
  nodes.flatMap((node) =>
    node.kind === "folder" ? flatten(node.children ?? []) : [node],
  );
export const displayName = (path: string, showExtensions=false) =>
  path
    .split("/")
    .pop()!
    .replace(showExtensions ? /$^/ : /\.[^./]+$/i, "");
export const folderOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
export const wordCount = (text: string) =>
  (text.match(/[\u3400-\u9fff]|[a-zA-Z0-9]+(?:['’-][a-zA-Z0-9]+)*/g) ?? [])
    .length;
