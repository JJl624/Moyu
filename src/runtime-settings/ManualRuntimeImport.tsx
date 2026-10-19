import { useEffect, useRef, useState } from "react";
import { Check } from 'lucide-react';
import { api } from "../bridge";
import { Modal } from "../Modal";
import { useRuntimePanelActive } from './RuntimeLayout';
import { RuntimeFileTree } from './RuntimeFileTree';
import { runtimeFileTree, runtimeFolder, runtimePathTree } from './runtimeTree';
type FileRow = {
  id: string;
  name: string;
  type: string;
  version?: string;
  url: string;
  projectURL?: string;
  sourcePage?: string;
  path?: string;
  size?: number;
  verified?: boolean;
  error?: string;
  dependencyIds?: string[];
  requiredFiles?: { name: string; bytes: number; url?: string }[];
};
type Plan = { token: string; language: string; version: string; files: FileRow[]; unmatched?: string[] };
export function ManualRuntimeImport(
  { language, active, busy, installed, checking, install, importEnvironment }: {
    language: string;
    active: boolean;
    busy: boolean;
    installed: string[];
    checking?(value: boolean): void;
    install(token: string): Promise<void>;
    importEnvironment(token: string): Promise<void>;
  },
) {
  const panelActive = useRuntimePanelActive();
  const [plan, setPlan] = useState<Plan | null>(null),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [directoryPreview, setDirectoryPreview] = useState<
      { token: string; path: string; version: string; files: string[]; issues: string[] } | null
    >(null),
    [information, setInformation] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    let alive = true;
    const ticket = ++revision.current;
    if (active && panelActive) {
      setError("");
      setWorking(true);
      const previous = plan?.language === language ? plan : null;
      if (!previous) {
        setDirectoryPreview(null);
        setPlan(null);
      }
      void api.feature<Plan>("manual-files.plan", { language, version: previous?.version, token: previous?.token })
        .then(value => {
          if (alive && ticket === revision.current) {
            setPlan(value);
            setWorking(false);
          }
        }).catch(e => {
          if (alive && ticket === revision.current) {
            setError(e.message);
            setWorking(false);
          }
        });
    }
    return () => {
      alive = false;
    };
  }, [active, language, panelActive]);
  const select = async (id?: string, directory = false) => {
    if (!plan) return;
    setWorking(true);
    checking?.(true);
    setError("");
    try {
      setPlan(await api.feature<Plan>("manual-files.select", { language, token: plan.token, id, directory }));
    } catch (e) {
      if ((e as { code?: string }).code !== "DOWNLOAD_CANCELLED") setError((e as Error).message);
    } finally {
      setWorking(false);
      checking?.(false);
    }
  };
  const choose = async (directory = false) => {
    setWorking(true);
    checking?.(true);
    setError("");
    try {
      const result = await api.feature<
        | {
          plan?: Plan;
          directory?: { token: string; path: string; version: string; files: string[]; issues: string[] };
        }
        | null
      >("manual-files.choose", { language, directory, token: plan?.token });
      if (result?.plan) {
        setPlan(result.plan);
        setDirectoryPreview(null);
      } else if (result?.directory) setDirectoryPreview(result.directory);
    } catch (e) {
      if ((e as { code?: string }).code !== "DOWNLOAD_CANCELLED") setError((e as Error).message);
    } finally {
      setWorking(false);
      checking?.(false);
    }
  };
  const add = async () => {
    if (!plan) return;
    setWorking(true);
    try {
      await install(plan.token);
    } finally {
      await api.feature<Plan>("manual-files.state", { language, token: plan.token }).then(setPlan).catch(e =>
        setError(e.message)
      );
      setWorking(false);
    }
  };
  const fileTree = (rows: FileRow[], compiler = true) => (
    <RuntimeFileTree nodes={runtimeFileTree(rows, runtimeFolder(language, compiler))}
      downloads={!plan || !installed.includes(plan.version)}
      status={file => file.id && (file.error
        ? <span className="feature-error">{file.error}</span>
        : file.verified ? <span className="manual-file-valid">已验证</span>
        : <span className="muted-note">未选择</span>)}
      actions={file => file.id && <>
        <button className="secondary-button" disabled={busy || working} title={file.path}
          aria-label={"选择文件 " + file.name} onClick={() => void select(file.id)}>
          {file.path ? "重新选择" : "选择"}
        </button>
        {file.type === "bundle" && <button className="text-button" disabled={busy || working}
          aria-label="选择运行文件夹" onClick={() => void select(file.id, true)}>选择文件夹</button>}
        {file.path && file.path.split(/[\\/]/).pop() !== file.name
          && <small title={file.path}>{file.path.split(/[\\/]/).pop()}</small>}
      </>}
    />
  );
  const verified = plan?.files.filter(file => file.verified && !file.error).length || 0;
  const installedStatus = <span className="runtime-import-status" role="status" aria-label="已安装">
    <Check size={13} aria-hidden="true" />已安装
  </span>;
  if (!active) return null;
  return (
    <section className="manual-runtime-import" aria-label="手动添加环境">
      <p className="muted-note">
        {language === "python"
          ? "选择 Pyodide 核心文件或其文件夹。"
          : language === "csharp"
          ? "选择包含 _framework 的 dist 文件夹，或包含该目录的 ZIP。"
          : language === "java"
          ? "选择 TeaVM 运行文件或其文件夹。"
          : "选择原始 npm .tgz 环境包，或含依赖的解压目录。"}
        <button className="text-button" onClick={() => setInformation(true)}>文件要求</button>
      </p>
      <div className="manual-files-actions">
        <button className="secondary-button" disabled={busy || working} onClick={() => void choose()}>选择文件</button>
        <button className="secondary-button" disabled={busy || working} onClick={() => void choose(true)}>
          选择文件夹
        </button>
      </div>
      {directoryPreview
        ? (
          <div className="runtime-import-preview">
            <p className="runtime-config-path">{directoryPreview.path}</p>
            <div className="runtime-import-summary">
              <p>识别版本：{directoryPreview.version || "未识别"}</p>
              {installed.includes(directoryPreview.version) && installedStatus}
            </div>
            <RuntimeFileTree nodes={runtimePathTree(directoryPreview.files.map(name => ({ name })))} />
            {!!directoryPreview.issues.length && (
              <ul className="feature-error" role="alert">
                {directoryPreview.issues.map(issue => <li key={issue}>{issue}</li>)}
              </ul>
            )}
            {!installed.includes(directoryPreview.version) && <button
              className="secondary-button"
              disabled={busy || working || !!error || !!directoryPreview.issues.length}
              onClick={() => void importEnvironment(directoryPreview.token)}
            >
              导入并启用
            </button>}
          </div>
        )
        : (
          <>
            {plan
              ? (
                <>
                  <div className="manual-files-heading">
                    <span>
                      所需文件 <small>版本 {plan.version}，已验证 {verified} / {plan.files.length}</small>
                    </span>
                    {installed.includes(plan.version) && installedStatus}
                  </div>
                  <h5>{["csharp", "java"].includes(language) ? "编译器与标准库" : "运行环境与依赖"}</h5>
                  {fileTree(plan.files.filter(file => !["csharp", "java"].includes(language) || file.type !== "npm"))}
                  {["csharp", "java"].includes(language) && (
                    <>
                      <h5>格式化插件与依赖</h5>
                      {fileTree(plan.files.filter(file => file.type === "npm"), false)}
                    </>
                  )}
                  {!!plan.unmatched?.length && (
                    <p className="muted-note" title={plan.unmatched.join("\n")}>
                      未匹配 {plan.unmatched.length} 个文件
                    </p>
                  )}
                  {!installed.includes(plan.version) && <button
                    className="secondary-button"
                    disabled={busy || working || !!error || verified !== plan.files.length}
                    onClick={() => void add()}
                  >
                    {working ? "处理中…" : "添加并启用"}
                  </button>}
                </>
              )
              : !error && <p role="status" className="muted-note">加载清单…</p>}
          </>
        )}
      {error && <p role="alert" className="feature-error">{error}</p>}
      {information && (
        <Modal title="文件要求" onClose={() => setInformation(false)}>
          <p className="modal-description">
            选择文件后会自动识别版本，并列出所需依赖。
          </p>
          {["csharp", "java"].includes(language) && (
            <p className="modal-description">
              C# 和 Java 使用当前配套的浏览器编译环境。普通 .NET SDK、JDK
              或仓库源码压缩包不适用；请按清单中的下载地址准备文件。
            </p>
          )}
        </Modal>
      )}
    </section>
  );
}
