import { useEffect, useState } from "react";
import { api } from "./bridge";
import { DownloadProgress } from "./DownloadProgress";
import { usePreferenceDraft } from "./preferenceDraft";
import { RuntimeInstaller } from "./runtime-settings/RuntimeInstaller";
import { RuntimeLayout, type RuntimeNotice, RuntimeSection, RuntimeVersions } from "./runtime-settings/RuntimeLayout";
import { runtimeNotice } from '../shared/runtime-notice.mjs';
import { PythonDownloadSource, officialPythonMirror, type PythonMirror as Mirror } from './runtime-settings/PythonDownloadSource';
interface PythonState {
  executionTimeoutSeconds: number;
  preparationTimeoutSeconds: number;
  selected: string;
  installed: string[];
  versions: string[];
  versionsUpdated: string | null;
  catalogUpdated: string | null;
  python: string;
  mirror: number;
  mirrors: Mirror[];
  packages: {
    name: string;
    version: string;
    depends: string[];
    installed: boolean;
    requested: boolean;
    canRemove: boolean;
  }[];
  progress: { file: string; name: string } | null;
  directory: string;
}
export function PythonPreferences() {
  const [state, setState] = useState<PythonState | null>(null),
    [version, setVersion] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const [notice, setNotice] = useState<RuntimeNotice>(null),
    [page, setPage] = useState(0),
    [pendingPackage, setPendingPackage] = useState("");
  useEffect(() => setPage(0), [query, filter, state?.selected]);
  type Config = {
    executionTimeoutSeconds: number;
    preparationTimeoutSeconds: number;
    mirrors: Mirror[];
    mirror: number;
  };
  const draft = usePreferenceDraft<Config | null>(
    "Python",
    null,
    async value => {
      if (value) setState(await api.feature<PythonState>("python.configure", value));
    },
    () => ({
      executionTimeoutSeconds: 10,
      preparationTimeoutSeconds: 60,
      mirrors: [{ ...officialPythonMirror }],
      mirror: 0,
    }),
  );
  const mirrors = draft.value?.mirrors || [],
    mirror = draft.value?.mirror || 0,
    executionLimit = draft.value?.executionTimeoutSeconds || 0,
    preparationLimit = draft.value?.preparationTimeoutSeconds || 0;
  const setExecutionLimit = (executionTimeoutSeconds: number) =>
    draft.set(v => v && ({ ...v, executionTimeoutSeconds }));
  const setPreparationLimit = (preparationTimeoutSeconds: number) =>
    draft.set(v => v && ({ ...v, preparationTimeoutSeconds }));
  const load = async () => {
    const data = await api.feature<PythonState>("python.state");
    setState(data);
    return data;
  };
  useEffect(() => {
    void load().then(s => {
      setVersion(s.selected || s.versions[0] || "");
      draft.load({
        executionTimeoutSeconds: s.executionTimeoutSeconds,
        preparationTimeoutSeconds: s.preparationTimeoutSeconds,
        mirrors: s.mirrors,
        mirror: s.mirror,
      });
    }).catch(e => setError(e.message));
  }, []);
  const action = async (name: string, input: Record<string, unknown> = {}) => {
    setBusy(name);
    setPendingPackage(String(input.name || ""));
    setError("");
    setNotice(null);
    try {
      await draft.commit();
      const data = await api.feature<PythonState>("python." + name, input);
      setState(data);
      if (name.startsWith("import") || name === "select") setVersion(data.selected);
      if (data.selected) setVersion(previous => previous || data.selected);
      const imported = !name.startsWith("import") || JSON.stringify(data.installed) !== JSON.stringify(state?.installed)
        || JSON.stringify(data.packages.filter(p => p.requested))
          !== JSON.stringify(state?.packages.filter(p => p.requested));
      if (imported) {
        setNotice({
          text: runtimeNotice(name),
        });
      }
    } catch (e) {
      if ((e as { code?: string }).code !== "DOWNLOAD_CANCELLED") setError((e as Error).message);
    } finally {
      setBusy("");
      setPendingPackage("");
    }
  };
  if (!api.desktop) return <p className="muted-note">Python 管理需要桌面应用。</p>;
  if (!state) return <p role={error ? "alert" : "status"}>{error || "加载中…"}</p>;
  const packages = state.packages.filter(p =>
    p.name.toLowerCase().includes(query.trim().toLowerCase())
    && (filter === "all" || (filter === "installed" ? p.installed : !p.installed))
  );
  const pages = Math.max(1, Math.ceil(packages.length / 20)), currentPage = Math.min(page, pages - 1);
  const settings = (
    <RuntimeSection title="运行时限">
      <label className="pref-row">
        <span>代码执行时限（秒）</span>
        <input
          aria-label="Python 代码执行时限"
          type="number"
          min={1}
          max={3600}
          step={1}
          value={Number.isNaN(draft.value?.executionTimeoutSeconds) ? "" : executionLimit}
          onChange={e => setExecutionLimit(e.target.value === "" ? NaN : Number(e.target.value))}
        />
      </label>
      <label className="pref-row">
        <span>环境准备时限（秒）</span>
        <input
          aria-label="Python 环境准备时限"
          type="number"
          min={1}
          max={3600}
          step={1}
          value={Number.isNaN(draft.value?.preparationTimeoutSeconds) ? "" : preparationLimit}
          onChange={e => setPreparationLimit(e.target.value === "" ? NaN : Number(e.target.value))}
        />
      </label>
    </RuntimeSection>
  );
  const environment = (
    <>
      <RuntimeSection title="已安装环境">
        <RuntimeVersions
          versions={state.installed.map(v => ({
            version: v,
            label: "Pyodide " + v,
            detail: v === state.selected && state.python ? "Python " + state.python : undefined,
          }))}
          selected={state.selected}
          reveal={v =>
            void api.feature("runtime.reveal", { language: "python", version: v }).catch(e => setError(e.message))}
          busy={!!busy}
          use={v => void action("select", { version: v })}
          remove={v => action("remove-runtime", { version: v })}
        />
      </RuntimeSection>
      <RuntimeInstaller
        checking={value => setBusy(value ? "verify-files" : "")}
        importFiles={token => action("import-files", { version, token })}
        installed={state.installed}
        language="python"
        sourceKey={JSON.stringify([state.mirrors, state.mirror, state.installed])}
        version={version}
        busy={!!busy}
        refresh={
          <button className="text-button" disabled={!!busy} onClick={() => void action("refresh-versions")}>
            {busy === "refresh-versions" ? "正在刷新…" : "刷新可用版本"}
          </button>
        }
        online={
          <>
            <label className="runtime-field">
              <span>可用版本</span>
              <div className="runtime-install">
                <select
                  aria-label="可用 Pyodide 版本"
                  value={version}
                  disabled={!!busy}
                  onChange={e => setVersion(e.target.value)}
                >
                  {[...new Set([...state.versions, ...state.installed])].map(v => <option key={v} value={v}>{v}
                  </option>)}
                </select>
                <button
                  className="secondary-button"
                  disabled={!!busy || !version || state.installed.includes(version)}
                  onClick={() => void action("install-runtime", { version })}
                >
                  {busy === "install-runtime" ? "安装中…" : state.installed.includes(version) ? "已安装" : "安装"}
                </button>
              </div>
            </label>
            <PythonDownloadSource mirrors={mirrors} selected={mirror} disabled={!!busy}
              change={(mirrors, mirror, apply) => {
                draft.set(value => value && ({ ...value, mirrors, mirror }));
                if (apply) draft.apply();
              }} />
          </>
        }
        importEnvironment={token => action("import-runtime", { version, token })}
      />

      <section className="runtime-location">
        <h4>环境目录</h4>
        <p className="runtime-config-path">{state.directory}</p>
        <button
          className="text-button"
          onClick={() => void api.feature("data.reveal", { id: "python" }).catch(e => setError(e.message))}
        >
          打开 Python 数据目录
        </button>
      </section>
    </>
  );
  const dependencies = (
    <>
      <RuntimeSection
        title="Python 包"
        actions={
          <>
            <button
              className="secondary-button"
              disabled={!!busy || !state.selected}
              onClick={() => void action("import-package")}
            >
              本地导入
            </button>
            <button
              className="text-button"
              disabled={!!busy || !state.selected}
              onClick={() => void action("refresh-packages", { version: state.selected })}
            >
              刷新包清单
            </button>
          </>
        }
      >
        <div className="runtime-package-filter">
          <input
            type="search"
            className="python-package-search"
            aria-label="搜索 Python 包"
            placeholder="搜索包名称"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <select aria-label="筛选 Python 包状态" value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">全部包</option>
            <option value="installed">已安装</option>
            <option value="available">未安装</option>
          </select>
        </div>
        <div className="python-package-list" aria-label="Python 包列表">
          {packages.slice(currentPage * 20, currentPage * 20 + 20).map(p => (
            <div className="python-package" key={p.name}>
              <div>
                <strong>{p.name}</strong>
                <small>{p.version}</small>
                {p.installed && <span className="runtime-current">{p.canRemove ? "已安装" : "依赖"}</span>}
              </div>
              {(!p.installed || p.canRemove) && (
                <button
                  className={p.installed ? "" : "secondary-button"}
                  disabled={!!busy || !state.selected}
                  onClick={() => void action(p.installed ? "remove-package" : "install-package", { name: p.name })}
                >
                  {busy && pendingPackage === p.name
                    ? "处理中…"
                    : p.installed
                    ? "卸载"
                    : "安装"}
                </button>
              )}
            </div>
          ))}
        </div>
        {!packages.length && <p className="runtime-empty">没有匹配的包</p>}
        <div className="runtime-pagination">
          <span>{packages.length} 个包</span>
          <div>
            <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button>
            <span>{currentPage + 1} / {pages}</span>
            <button disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>下一页</button>
          </div>
        </div>
      </RuntimeSection>
      <section className="runtime-import-help">
        <p>选择当前 Pyodide 清单对应的 .whl / .zip，可同时选择依赖文件。普通 CPython 的二进制包不一定兼容。</p>
      </section>
    </>
  );
  return (
    <div
      className="python-preferences"
      {...draft.events}
      onChange={event => {
        setError("");
        setNotice(null);
        const target = event.target as HTMLInputElement;
        if (target.tagName === "SELECT") draft.apply();
      }}
    >
      <RuntimeLayout
        title="Python"
        summary={state.selected
          ? "Pyodide " + state.selected + (state.python ? " / Python " + state.python : "")
          : "Pyodide"}
        ready={!!state.selected}
        beforeChange={draft.commit}
        busy={!!busy}
        restart={() => {
          setBusy("reset");
          setError("");
          void draft.commit().then(() => api.feature("code.reset-python")).then(() => setNotice({ text: "已重启" }))
            .catch(e => setError(e.message)).finally(() => setBusy(""));
        }}
        notice={error || draft.error ? { text: error || draft.error, error: true } : notice}
        progress={<DownloadProgress scope="python" />}
        panels={[{ id: "settings", label: "运行设置", content: settings }, {
          id: "environment",
          label: "环境",
          content: environment,
        }, { id: "dependencies", label: "依赖", content: dependencies }]}
      />
      {draft.saving && <small role="status">正在应用…</small>}
    </div>
  );
}
