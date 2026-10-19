import { isComposingKey } from './keyboardComposition';
import type { ExcalidrawImperativeAPI, LibraryItems } from "@excalidraw/excalidraw/types";
import { Excalidraw, exportToBlob, exportToSvg, MainMenu, MoyuLibrary, serializeAsJSON } from "moyu-excalidraw";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import "@excalidraw/excalidraw/index.css";
import { api } from "./bridge";
import { type DrawingFont, DrawingFonts, initializeDrawingFonts } from "./DrawingFonts";
import type { DiskDocument, OpenDocument } from "./types";
export interface DrawingHandle {
  flush: () => Promise<void>;
}
interface Props {
  root: string;
  readOnly?: boolean;
  document: OpenDocument;
  notePath: string;
  theme: "dark" | "light";
  onChange: (content: string) => void;
  save: () => Promise<boolean>;
  resolve: (action: "disk" | "mine") => Promise<void>;
  onCopy: (path: string) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onInsert: (image: string, source: string) => Promise<void>;
  onClose: () => void;
  notify: (text: string) => void;
}
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH =
  new URL("./excalidraw/", document.baseURI).href;
export default forwardRef<DrawingHandle, Props>(function DrawingEditor(p, ref) {
  const canvas = useRef<ExcalidrawImperativeAPI | null>(null),
    initial = useRef<any>(null);
  if (initial.current === null) initial.current = JSON.parse(p.document.content);
  const normalized = useRef<string | null>(null), callbacks = useRef(p);
  const library = useRef<LibraryItems>([]), libraryRoot = useRef(p.root), librarySnapshot = useRef('[]'),
    libraryPending = useRef<Promise<unknown>>(Promise.resolve()), libraryError = useRef<Error | null>(null);
  callbacks.current = p;
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [libraryMessage, setLibraryMessage] = useState('');
  const originalName = p.document.path.split("/").pop()!.replace(/\.excalidraw$/i, "");
  const [fileName, setFileName] = useState(originalName);
  const [fontManager, setFontManager] = useState(false),
    [fontReady, setFontReady] = useState(false),
    [fontRevision, setFontRevision] = useState(0);
  const saveLibrary = (items: LibraryItems) => {
    if(p.readOnly)return;
    library.current = items;
    const snapshot = JSON.stringify(items);
    if (!libraryRoot.current || snapshot === librarySnapshot.current) return;
    librarySnapshot.current = snapshot;
    libraryPending.current = api.feature('drawing.library-save', { root: libraryRoot.current, libraryItems: items }).then(() => {
      libraryError.current = null;
      setLibraryMessage('');
    }).catch(e => {
      libraryError.current = e;
      setLibraryMessage(e.message);
    });
  };
  const applyFonts = (fonts: DrawingFont[]) => {
    const ids = new Set(fonts.map(f => f.id));
    const scene = canvas.current
      ? {
        ...initial.current,
        elements: canvas.current.getSceneElements(),
        appState: canvas.current.getAppState(),
        files: canvas.current.getFiles(),
      }
      : initial.current;
    let changed = false;
    scene.elements = scene.elements.map((e: any) => {
      if (e.type === "text" && e.fontFamily >= 10000 && !ids.has(e.fontFamily)) {
        changed = true;
        return { ...e, fontFamily: 5, version: (e.version || 0) + 1, updated: Date.now() };
      }
      return e;
    });
    if (
      scene.appState?.currentItemFontFamily >= 10000
      && !ids.has(scene.appState.currentItemFontFamily)
    ) scene.appState.currentItemFontFamily = 5;
    initial.current = scene;
    let libraryChanged = false;
    const nextLibrary = library.current.map(item => ({ ...item, elements: item.elements.map(element => {
      if (element.type === 'text' && element.fontFamily >= 10000 && !ids.has(element.fontFamily)) {
        libraryChanged = true;
        return { ...element, fontFamily: 5, version: element.version + 1, updated: Date.now() };
      }
      return element;
    }) }));
    if (libraryChanged) saveLibrary(nextLibrary);
    normalized.current = null;
    if (changed) callbacks.current.onChange(JSON.stringify(scene, null, 2));
    setFontRevision(v => v + 1);
  };
  useEffect(() => {
    let alive = true;
    MoyuLibrary.setLoader(async () => {
      const content = await api.feature<string | null>('drawing.library-open');
      if (content === null) throw new DOMException('已取消打开素材库。', 'AbortError');
      return new Blob([content], { type: 'application/json' });
    });
    const loaded = api.feature<{root: string;libraryItems: LibraryItems}>('drawing.library-read').then(value => {
      if (!alive) return;
      if (value.root !== p.root) throw new Error('知识库已切换，请重新打开绘图。');
      libraryRoot.current = value.root;
      library.current = value.libraryItems;
      librarySnapshot.current = JSON.stringify(value.libraryItems);
    }).catch(e => { if (alive) setLibraryMessage(e.message); });
    void Promise.all([initializeDrawingFonts(true, p.document.path), loaded]).then(([fonts]) => {
      if (!alive) return;
      applyFonts(fonts);
      setFontReady(true);
    }).catch(e => {
      if (!alive) return;
      setError(e.message);
      setFontReady(true);
    });
    return () => { alive = false; };
  }, []);
  const flush = async () => {
    if (!(await callbacks.current.save())) {
      throw new Error(callbacks.current.document.error || "绘图未保存，请处理文件冲突。");
    }
  };
  // Excalidraw already publishes edits through onChange. Parent navigation
  // captures the buffer; the workspace save policy decides whether to write.
  useImperativeHandle(ref, () => ({ flush: async () => {
    await libraryPending.current;
    if (libraryError.current) throw libraryError.current;
  } }));
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const exportImage = async (format: "png" | "svg", insert = false) => {
    if (!canvas.current) return;
    await flush();
    const args = {
      elements: canvas.current.getSceneElements(),
      appState: {
        ...canvas.current.getAppState(),
        exportBackground: true,
        exportWithDarkMode: p.theme === "dark",
      },
      files: canvas.current.getFiles(),
    };
    const bytes = format === "png"
      ? new Uint8Array(await (await exportToBlob({ ...args, mimeType: "image/png" })).arrayBuffer())
      : new TextEncoder().encode((await exportToSvg(args)).outerHTML);
    const image = await api.feature<{ path: string }>("drawing.image", {
      path: p.document.path,
      document: p.notePath || p.document.path,
      format,
      bytes,
    });
    if (insert) await p.onInsert(image.path, p.document.path);
    else p.notify("已导出到 " + image.path);
  };
  const saveCopy = async () => {
    const path = p.document.path.replace(/\.excalidraw$/i, "-副本-" + Date.now() + ".excalidraw");
    await api.feature<DiskDocument>("drawing.create", { path, content: p.document.content });
    // Recover the original's disk state after the copy succeeds, so navigation
    // and closing no longer retry the conflicting old version.
    await p.onCopy(path);
    p.notify("已另存为 " + path);
  };
  return (
    <div className="drawing-editor">
      <div className="drawing-toolbar">
        <form
          className="drawing-filename"
          onSubmit={event => {
            event.preventDefault();
            if (busy || fileName === originalName) return;
            void run(async () => {
              const name = fileName.trim().replace(/\.excalidraw$/i, "");
              if (!name || /[/\\]/.test(name)) throw new Error("请输入有效的文件名。");
              await p.onRename(name + ".excalidraw");
            });
          }}
        >
          <input
            aria-label="绘图文件名"
            title={p.document.path}
            value={fileName}
            disabled={busy}
            maxLength={200}
            onChange={event => setFileName(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Escape" && !isComposingKey(event)) {
                event.preventDefault();
                setFileName(originalName);
                event.currentTarget.blur();
              }
            }}
          />
          <span>.excalidraw</span>
          {fileName !== originalName && <button type="submit" disabled={busy}>保存名称</button>}
        </form>
        <small>
          {p.document.saving ? "正在保存…" : p.document.dirty ? "本地未保存" : "已保存到本地"}
        </small>
        <div className="drawing-toolbar-spacer" />
        <button disabled={busy} onClick={() => void run(flush)}>保存</button>
        <button disabled={busy} onClick={() => void run(() => exportImage("svg"))}>导出 SVG</button>
        <button disabled={busy} onClick={() => void run(() => exportImage("png"))}>导出 PNG</button>
        <button disabled={busy} onClick={() => void run(() => p.onInsert("", p.document.path))}>
          复制链接
        </button>
        <button disabled={busy || !fontReady} onClick={() => setFontManager(!fontManager)}>
          字体管理
        </button>
        <button disabled={busy} onClick={p.onClose}>关闭画布</button>
      </div>
      {(p.document.error || error || libraryMessage) && (
        <div className="drawing-error" role="alert">
          <span>{p.document.error || error || libraryMessage}</span>
          {p.document.conflict && (
            <>
              <button disabled={busy} onClick={() => void run(() => p.resolve("disk"))}>
                使用磁盘版本
              </button>
              <button disabled={busy} onClick={() => void run(() => p.resolve("mine"))}>
                保留当前版本
              </button>
            </>
          )}
          <button disabled={busy} onClick={() => void run(saveCopy)}>另存当前画布</button>
        </div>
      )}
      {fontManager && (
        <DrawingFonts
          path={p.document.path}
          beforeChange={async () => {}}
          onChange={applyFonts}
          onClose={() => setFontManager(false)}
        />
      )}
      <div className="drawing-canvas">
        {fontReady && (
          <Excalidraw
            key={fontRevision}
            viewModeEnabled={p.readOnly}
            theme={p.theme}
            langCode="zh-CN"
            initialData={{ ...initial.current, libraryItems: library.current }}
            onLibraryChange={saveLibrary}
            excalidrawAPI={v => {
              canvas.current = v;
            }}
            UIOptions={{
              canvasActions: {
                loadScene: false,
                saveToActiveFile: false,
                export: false,
                saveAsImage: false,
              },
              tools: { image: true },
            }}
            onChange={(elements, appState, files) => {
              if(callbacks.current.readOnly)return;
              const scene = JSON.parse(serializeAsJSON(elements, appState, files, "local"));
              // Preserve existing unknown metadata; removing UI never deletes user data.
              for (
                const [key, value] of Object.entries(initial.current)
              ) {
                if (!["type", "version", "source", "elements", "appState", "files"].includes(key)) {
                  scene[key] = value;
                }
              }
              const content = JSON.stringify(scene, null, 2);
              if (normalized.current === null) {
                normalized.current = content;
                return;
              }
              if (content === normalized.current) {
                return;
              }
              normalized.current = content;
              callbacks.current.onChange(content);
            }}
          >
            <MainMenu>
              <MainMenu.DefaultItems.ClearCanvas />
              <MainMenu.DefaultItems.ChangeCanvasBackground />
            </MainMenu>
          </Excalidraw>
        )}
      </div>
    </div>
  );
});
