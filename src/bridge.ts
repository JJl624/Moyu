import type { DesktopAPI, DiskDocument, FileNode, Workspace } from "./types";
import { folderOf } from "./types";

const demo = import.meta.glob("../resources/demo-vault/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const storageKey = "moyu-browser-files-v1";
interface BrowserFiles {
  [path: string]: { content: string; updated: number };
}
let files: BrowserFiles;
try {
  files = JSON.parse(localStorage.getItem(storageKey) ?? "null");
} catch {
  files = null!;
}
if (!files)
  files = Object.fromEntries(
    Object.entries(demo).map(([path, content]) => [
      path.split("/demo-vault/")[1],
      { content, updated: Date.now() },
    ]),
  );
const folders = new Set<string>(
  JSON.parse(localStorage.getItem("moyu-browser-folders") ?? "[]"),
);
const version = (content: string) => content; // Desktop uses SHA-256; browser preview uses exact content comparison.
const read = async (path: string): Promise<DiskDocument> => {
  if (!files[path]) throw new Error("文档不存在。");
  return { path, ...files[path], version: version(files[path].content) };
};
const list = async (): Promise<Workspace> => {
  const tree: FileNode[] = [];
  const add = (path: string, kind: "folder" | "file") => {
    const segments = path.split("/");
    let level = tree;
    segments.forEach((name, index) => {
      const relative = segments.slice(0, index + 1).join("/");
      let node = level.find((n) => n.path === relative);
      if (!node) {
        node = {
          path: relative,
          name,
          kind: index === segments.length - 1 ? kind : "folder",
          children: [],
        };
        level.push(node);
      }
      if (node.kind === "file")
        Object.assign(node, {
          updated: files[relative]?.updated,
          size: files[relative]?.content.length,
        });
      level = node.children!;
    });
  };
  Array.from(folders).forEach((path) => add(path, "folder"));
  Object.keys(files).forEach((path) => add(path, "file"));
  const sort = (nodes: FileNode[]) => {
    nodes.sort((a, b) =>
      a.kind === b.kind
        ? a.name.localeCompare(b.name, "zh-CN")
        : a.kind === "folder"
          ? -1
          : 1,
    );
    nodes.forEach((n) => sort(n.children ?? []));
  };
  sort(tree);
  return { root: "browser-preview", name: "我的知识库", tree };
};
const changes = new Set<(state: Workspace) => void>();
const persist = async () => {
  localStorage.setItem(storageKey, JSON.stringify(files));
  localStorage.setItem("moyu-browser-folders", JSON.stringify([...folders]));
  const state = await list();
  changes.forEach((listener) => listener(state));
};
const browserAPI: DesktopAPI = {
  updateState: async () => { throw Error('请在桌面版中检查更新。'); },
  checkUpdate: async () => { throw Error('请在桌面版中检查更新。'); },
  configureUpdate: async () => { throw Error('请在桌面版中检查更新。'); },
  feature: async () => {
    throw new Error("请在桌面版中使用 WebDAV 和绘图文件。");
  },
  desktop: false,
  platform: "browser",
  load: list,
  list,
  read,
  openVault: async () => {
    throw new Error(
      "请在桌面版中打开本地文件夹。浏览器预览的内容保存在当前浏览器中。",
    );
  },
  save: async (path, content, expected) => {
    const current = await read(path);
    if (current.version !== expected)
      throw Object.assign(new Error("文档已发生变更。"), {
        code: "CONFLICT",
        current,
      });
    files[path] = { content, updated: Date.now() };
    await persist();
    return read(path);
  },
  create: async (path, kind, content = "") => {
    if (files[path] || folders.has(path)) throw new Error("这个名称已经存在。");
    if (kind === "folder") folders.add(path);
    else files[path] = { content, updated: Date.now() };
    await persist();
    return kind === "file"
      ? read(path)
      : { path, content: "", version: "", updated: Date.now() };
  },
  rename: async (from, to) => {
    if (files[to] || folders.has(to)) throw new Error("这个名称已经存在。");
    Object.keys(files).forEach((key) => {
      if (key === from || key.startsWith(from + "/")) {
        files[to + key.slice(from.length)] = files[key];
        delete files[key];
      }
    });
    Array.from(folders).forEach((key) => {
      if (key === from || key.startsWith(from + "/")) {
        folders.add(to + key.slice(from.length));
        folders.delete(key);
      }
    });
    await persist();
    return { path: to };
  },
  trash: async (path) => {
    const removed = Object.fromEntries(
      Object.entries(files).filter(
        ([key]) => key === path || key.startsWith(path + "/"),
      ),
    );
    localStorage.setItem(
      "moyu-browser-trash-" + Date.now(),
      JSON.stringify(removed),
    );
    Object.keys(removed).forEach((key) => delete files[key]);
    Array.from(folders)
      .filter((key) => key === path || key.startsWith(path + "/"))
      .forEach((key) => folders.delete(key));
    await persist();
    return list();
  },
  search: async (query) =>
    Object.entries(files)
      .map(([path, value]) => ({
        path,
        name: path.split("/").pop()!,
        matches: value.content
          .split("\n")
          .map((text, i) => ({ text, line: i + 1 }))
          .filter((m) => m.text.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 5),
      }))
      .filter(
        (r) =>
          r.path.toLowerCase().includes(query.toLowerCase()) ||
          r.matches.length,
      ),
  importFiles: () =>
    new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".md,.markdown";
      input.multiple = true;
      input.oncancel = () => resolve([]);
      input.onchange = async () => {
        const imported: string[] = [];
        for (const file of Array.from(input.files ?? [])) {
          let name = file.name,
            suffix = 1;
          while (files[name])
            name = file.name.replace(/\.(md|markdown)$/i, ` (${suffix++}).md`);
          await browserAPI.create(name, "file", await file.text());
          imported.push(name);
        }
        resolve(imported);
      };
      input.click();
    }),
  exportFile: async (kind, name, content) => {
    const url = URL.createObjectURL(
      new Blob([content], {
        type:
          kind === "md"
            ? "text/markdown;charset=utf-8"
            : "text/html;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name.replace(/\.(md|markdown)$/i, "") + "." + kind;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  },
  exportPDF: async () => {
    window.print();
    return true;
  },
  upload: async (_document, name, bytes) => {
    const file = new Blob([bytes.slice().buffer], {
      type: "image/" + name.split(".").pop()?.replace("jpg", "jpeg"),
    });
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
  },
  assetData: async (path) => path,
  reveal: async () => {
    throw new Error("在桌面版中可定位本地文件。");
  },
  openExternal: async (url) => {
    if (/^(https?:|mailto:)/i.test(url))
      window.open(url, "_blank", "noopener,noreferrer");
  },
  windowControl: async () => {},
  confirmClose: async () => {},
  onChange: (callback) => {
    changes.add(callback);
    return () => {
      changes.delete(callback);
    };
  },
  onCommand: () => () => {},
  onBeforeClose: () => () => {},
};
function wrapDesktop(bridge: DesktopAPI): DesktopAPI {
  const wrapped = { ...bridge };
  const methods = [
    "feature",
    "load",
    "openVault",
    "list",
    "read",
    "save",
    "create",
    "rename",
    "trash",
    "search",
    "importFiles",
    "exportFile",
    "exportPDF",
    "upload",
    "assetData",
    "reveal",
    "openExternal",
    "windowControl",
    "updateState",
    "checkUpdate",
    "configureUpdate",
    "confirmClose",
  ] as const;
  for (const method of methods) {
    (wrapped as unknown as Record<string, unknown>)[method] = async (
      ...args: unknown[]
    ) => {
      const raw = bridge[method] as unknown as (...args: unknown[]) => Promise<{
        ok: boolean;
        data: unknown;
        error: { message: string; code?: string; current?: DiskDocument };
      }>;
      const syncing=method==='feature' && (args[0]==='webdav.sync'||args[0]==='webdav.resolve');
      if(syncing)window.dispatchEvent(new CustomEvent('moyu-sync-phase',{detail:'syncing'}));
      const result = await raw(...args);
      if(syncing || (method==='feature' && args[0]==='connections.save')) window.dispatchEvent(new CustomEvent('moyu-sync-phase',{detail:result.ok?'idle':'error'}));
      if (!result.ok)
        throw Object.assign(new Error(result.error.message), result.error);
      return result.data;
    };
  }
  return wrapped;
}
export const api = window.moyu ? wrapDesktop(window.moyu) : browserAPI;
export const assetURL = (document: string, src: string) => {
  if (/^(https:|data:|blob:|moyu-asset:)/i.test(src)) return src;
  if (!api.desktop) return src;
  // Markdown URLs may already percent-encode Unicode or spaces. Decode once
  // before encoding the native asset URL, otherwise % becomes %25.
  try {
    src = decodeURIComponent(src);
  } catch { /* Keep literal malformed percent sequences as a file name. */ }
  const parts = (folderOf(document) + "/" + src).split("/").filter(Boolean);
  const resolved: string[] = [];
  parts.forEach((part) => {
    if (part === "..") resolved.pop();
    else if (part !== ".") resolved.push(part);
  });
  return (api.platform === 'android' ? 'https://appassets.androidplatform.net/vault/' : "moyu-asset://vault/")
    + resolved.map(encodeURIComponent).join("/");
};
