import { FilePlus2, FolderOpen, Link2, LocateFixed, RefreshCw, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./bridge";
import { canonicalLanguage, codeBlocks, codeKey } from "./codeBlocks";
import type { FileNode } from "./types";
import { FileNameInput } from "./workspace/FileNameInput";
interface Group {
  key: string;
  id: string;
  language: string;
  path: string;
  global: boolean;
  associated: boolean;
  files: { name: string; path: string; size: number }[];
}
export function DataPanel({
  root,
  document,
  content,
  files,
  open,
  refresh,
  trash,
  locate,
  scopes = {},
  ensureIds,
  revealKey,
  revealRequest = 0,
}: {
  root: string;
  document: string;
  content: string;
  files: FileNode[];
  open(path: string): Promise<unknown>;
  refresh(): Promise<void>;
  trash(path: string): Promise<boolean>;
  locate(id: string): void;
  scopes?: Record<string, "block" | "global" | "memory">;
  ensureIds(): string;
  revealKey?: string;
  revealRequest?: number;
}) {
  const panel = useRef<HTMLElement>(null);
  const shownKey = useRef("");
  const [groups, setGroups] = useState<Group[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [languageFilter, setLanguageFilter] = useState("all"),
    [directoryFilter, setDirectoryFilter] = useState("existing"),
    [selectedKey, setSelectedKey] = useState(""),
    [creating, setCreating] = useState(""),
    [rebind, setRebind] = useState(""),
    [remove, setRemove] = useState<{ name: string; path: string } | null>(null);
  const blocks = useMemo(() => codeBlocks(content), [content]);
  const load = async () => setGroups(await api.feature<Group[]>("code.data-list", { document, content }));
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(
      () =>
        void api.feature<Group[]>("code.data-list", { document, content }).then(data => {
          if (alive) {
            setGroups(data);
            setError("");
          }
        }).catch(e => {
          if (alive) setError(e.message);
        }),
      250,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [root, document, files, content]);
  useEffect(() => {
    if (revealKey) {
      setSelectedKey(revealKey);
      setLanguageFilter("all");
      setDirectoryFilter("all");
    }
  }, [revealKey, revealRequest]);
  useEffect(() => {
    const request = revealRequest + ":" + revealKey;
    if (revealKey && shownKey.current !== request) {
      const group = panel.current?.querySelector<HTMLElement>(
        "[data-code-data-key=\"" + revealKey + "\"]",
      );
      if (group) {
        group.scrollIntoView({ block: "center" });
        shownKey.current = request;
      }
    }
  }, [revealKey, revealRequest, groups, languageFilter, directoryFilter]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const names = new Map(
    blocks.map(b => [
      b.id || "pending-" + b.start,
      b,
    ]),
  );
  const globalBlock = blocks.find(b =>
    canonicalLanguage(b.language) === "SQL" && scopes[b.id || codeKey(b)] === "global"
  );
  if (globalBlock) names.set("SQL_GLOBAL", globalBlock);
  const keys = [...new Set([...names.keys(), ...groups.map(g => g.key)])];
  const languages = [
    ...new Set(keys.map(key =>
      canonicalLanguage(
        names.get(key)?.language || groups.find(g => g.key === key)?.language || "",
      )
    )),
  ].filter(Boolean).sort();
  const filtered = keys.filter(key => {
    const group = groups.find(g => g.key === key);
    const language = canonicalLanguage(names.get(key)?.language || group?.language || "");
    return (languageFilter === "all" || languageFilter === language)
      && (directoryFilter === "all" || (directoryFilter === "existing" ? !!group : !group));
  });
  return (
    <section ref={panel} className="feature-panel" aria-label="代码块数据">
      <div className="feature-heading">
        <FolderOpen size={17} />
        <strong>代码块数据</strong>
        <button aria-label="刷新代码数据" onClick={() => void act(load)}>
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="code-data-filters">
        <select
          aria-label="按语言筛选代码数据"
          value={languageFilter}
          onChange={e => setLanguageFilter(e.target.value)}
        >
          <option value="all">全部语言</option>
          {languages.map(language => <option key={language} value={language}>{language}</option>)}
        </select>
        <select
          aria-label="按目录筛选代码数据"
          value={directoryFilter}
          onChange={e => setDirectoryFilter(e.target.value)}
        >
          <option value="all">全部目录状态</option>
          <option value="existing">已有数据目录</option>
          <option value="missing">未创建目录</option>
        </select>
      </div>
      {error && <p className="feature-error" role="alert">{error}</p>}
      {filtered.map(key => {
        const block = names.get(key),
          group = groups.find(g => g.key === key),
          language = block?.language || group?.language || "",
          associated = !!block || group?.global;
        const input = {
          root,
          document,
          content,
          language,
          id: block?.id || group?.id,
          scope: key === "SQL_GLOBAL" ? "global" : "block",
        };
        const candidates = blocks.filter(b => !groups.some(g => g.key === b.id));
        return (
          <div
            className={"code-data-group" + (selectedKey === key ? " selected" : "")}
            key={key}
            data-code-data-key={key}
            onClick={() => setSelectedKey(key)}
          >
            <header className="code-data-heading">
              <h4>
                {key === "SQL_GLOBAL"
                  ? "全局"
                  : canonicalLanguage(language) || (block ? "Text" : "未关联代码块")}
              </h4>
              <code className="data-block-id">
                {key === "SQL_GLOBAL" ? key : block?.id || group?.id || "待分配"}
              </code>
              {!associated && <small className="data-unassociated">未关联</small>}
              <button
                className="icon-button"
                title="定位代码块"
                aria-label={"定位代码块 " + key}
                disabled={!block?.id}
                onClick={() => block && locate(block.id)}
              >
                <LocateFixed size={14} />
              </button>
              <button
                className="icon-button"
                title="在资源管理器打开"
                aria-label={"在资源管理器打开 " + key}
                disabled={!group}
                onClick={() =>
                  group
                  && void api.feature("file.open", { path: group.path }).catch(e => setError(e.message))}
              >
                <FolderOpen size={14} />
              </button>
              <button
                className="icon-button"
                title="新建文件"
                aria-label={"新建数据文件 " + key}
                disabled={busy}
                onClick={() => setCreating(creating === key ? "" : key)}
              >
                <FilePlus2 size={14} />
              </button>
              <label
                className="icon-button attachment-upload"
                title="添加文件"
                aria-label={"添加文件 " + key}
              >
                <Upload size={14} />
                <input
                  type="file"
                  multiple
                  disabled={busy || !associated}
                  onChange={e => {
                    const selected = Array.from(e.target.files || []);
                    e.target.value = "";
                    void act(async () => {
                      let uploadInput = input;
                      if (block) {
                        const normalized = ensureIds(),
                          updated = codeBlocks(normalized).find(b =>
                            b.language.toLowerCase() === block.language.toLowerCase()
                            && b.code === block.code && b.occurrence === block.occurrence
                          );
                        if (!updated) throw new Error("代码块已改变，请重新添加文件。");
                        uploadInput = { ...input, content: normalized, id: updated.id };
                      }
                      for (const f of selected) {
                        await api.feature("code.data-upload", {
                          ...uploadInput,
                          name: f.name,
                          bytes: new Uint8Array(await f.arrayBuffer()),
                        });
                      }
                    });
                  }}
                />
              </label>
              {!associated && (
                <button
                  className="icon-button"
                  title="重新关联"
                  aria-label={"重新关联 " + key}
                  disabled={busy}
                  onClick={() => setRebind(rebind === key ? "" : key)}
                >
                  <Link2 size={14} />
                </button>
              )}
            </header>
            <small>{group?.path || "未创建"}</small>
            {creating === key && (
              <div className="code-data-new-file">
                <FileNameInput
                  cancel={() => setCreating("")}
                  create={async (name) => {
                    setBusy(true);
                    try {
                      let target = input;
                      if (block) {
                        const normalized = ensureIds(),
                          updated = codeBlocks(normalized).find(b =>
                            b.language.toLowerCase() === block.language.toLowerCase() && b.code === block.code
                            && b.occurrence === block.occurrence
                          );
                        if (!updated?.id) throw Error("代码块已改变，请重新创建文件");
                        target = { ...input, content: normalized, id: updated.id };
                      }
                      await api.feature("code.data-create", { ...target, name });
                      setCreating("");
                      await refresh();
                      await load();
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </div>
            )}
            {rebind === key && (
              <div className="data-rebind">
                <select
                  aria-label={"关联代码块 " + key}
                  defaultValue=""
                  disabled={busy}
                  onChange={e => {
                    const b = candidates.find(b => (b.id || "pending-" + b.start) === e.target.value);
                    if (b) {
                      void act(async () => {
                        const updatedContent = ensureIds();
                        const updated = codeBlocks(updatedContent).find(block =>
                          block.language.toLowerCase() === b.language.toLowerCase()
                          && block.code === b.code && block.occurrence === b.occurrence
                        );
                        if (!updated?.id) throw new Error("代码块已改变，请重新关联。");
                        await api.feature("code.data-rebind", {
                          ...input,
                          content: updatedContent,
                          key,
                          id: updated.id,
                          language: b.language,
                        });
                        setRebind("");
                      });
                    }
                  }}
                >
                  <option value="">选择代码块</option>
                  {candidates.map(b => (
                    <option key={b.id || b.start} value={b.id || "pending-" + b.start}>
                      {canonicalLanguage(b.language)} {b.id} {b.code.split("\n")[0].slice(0, 32)}
                    </option>
                  ))}
                </select>
                {!candidates.length && <small>无可关联代码块</small>}
              </div>
            )}
            {group?.files.map(file => (
              <div className="data-file" key={file.name}>
                <button title={file.path} onClick={() => void open(file.path)}>
                  {file.name}
                  <small>{Math.ceil(file.size / 1024)} KB</small>
                </button>
                <button
                  aria-label={"删除数据 " + file.name}
                  disabled={busy}
                  onClick={() => setRemove(file)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        );
      })}
      {!blocks.length && !groups.length && <p className="muted-note">暂无代码数据</p>}
      {!!keys.length && !filtered.length && <p className="muted-note">无匹配项</p>}
      {remove && (
        <div className="attachment-confirm" role="alert">
          <p>将 {remove.name} 移至回收站？</p>
          <button className="secondary-button" onClick={() => setRemove(null)}>取消</button>
          <button
            className="danger"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                if (await trash(remove.path)) setRemove(null);
              })}
          >
            移至回收站
          </button>
        </div>
      )}
    </section>
  );
}
