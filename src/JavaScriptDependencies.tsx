import { useEffect, useState } from "react";
import { api } from "./bridge";
import { DownloadSource } from "./DownloadSource";
import { type RuntimeNotice, RuntimeSection } from "./runtime-settings/RuntimeLayout";
import { runtimeNotice } from '../shared/runtime-notice.mjs';
type State = {
  registry: string;
  root: string;
  packages: Record<string, { selected: string; versions: string[] }>;
};
export function JavaScriptDependencies(
  { onNotice, onBusy }: { onNotice(notice: RuntimeNotice): void; onBusy(busy: boolean): void },
) {
  const [state, setState] = useState<State | null>(null),
    [name, setName] = useState(""),
    [versions, setVersions] = useState<string[]>([]),
    [version, setVersion] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [filter, setFilter] = useState(""),
    [confirm, setConfirm] = useState(""),
    [installMode, setInstallMode] = useState("online");
  useEffect(() => {
    let alive = true;
    void api.feature<State>("javascript.state").then(v => {
      if (alive) setState(v);
    }).catch(e => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
    };
  }, []);
  const perform = async (action: string, packageName = name, selected = version, archive = false) => {
    setBusy(true);
    onBusy(true);
    onNotice(null);
    setError("");
    try {
      if (action === "versions") {
        const result = await api.feature<{ versions: string[] }>("javascript.versions", {
          name: packageName,
        });
        setVersions(result.versions);
        setVersion(result.versions[0] || "");
        if (!result.versions.length) onNotice({ text: "暂无可用版本" });
      } else {
        const next = await api.feature<State>("javascript." + action, {
          name: packageName,
          version: selected,
          archive,
        });
        setState(next);
        setConfirm("");
        if (action !== "import" || JSON.stringify(next.packages) !== JSON.stringify(state?.packages)) {
          onNotice({
            text: (action === 'import' ? '' : packageName + ' ') + (action === 'remove' ? '已卸载' : runtimeNotice(action)),
          });
        }
      }
    } catch (e) {
      if ((e as { code?: string }).code !== "DOWNLOAD_CANCELLED") {
        setError((e as Error).message);
        onNotice({ text: (e as Error).message, error: true });
      }
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  const source = async (registry: string) => {
    setBusy(true);
    onBusy(true);
    onNotice(null);
    setError("");
    try {
      setState(await api.feature<State>("javascript.configure", { registry }));
      setVersions([]);
      setVersion("");
    } catch (e) {
      setError((e as Error).message);
      onNotice({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  const installed = Object.entries(state?.packages || {}).filter(([pkg]) =>
    pkg.toLowerCase().includes(filter.toLowerCase())
  ).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="javascript-dependencies" aria-busy={busy}>
      <RuntimeSection title="添加 npm 包">
        <div className="runtime-install-method" role="group" aria-label="包安装方式">
          <button disabled={busy} aria-pressed={installMode === "online"} onClick={() => setInstallMode("online")}>
            在线安装
          </button>
          <button disabled={busy} aria-pressed={installMode === "local"} onClick={() => setInstallMode("local")}>
            本地导入
          </button>
        </div>
        <div hidden={installMode !== "online"}>
          <label className="runtime-field">
            <span>包名称</span>
            <div className="runtime-install">
              <input
                aria-label="npm 包名"
                placeholder="例如 d3、lodash-es"
                value={name}
                disabled={busy}
                onChange={e => {
                  setName(e.target.value.trim());
                  setVersions([]);
                  setVersion("");
                }}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (name && !busy) void perform("versions");
                  }
                }}
              />
              <button className="secondary-button" disabled={busy || !name} onClick={() => void perform("versions")}>
                查询版本
              </button>
            </div>
          </label>
          {!!versions.length && (
            <label className="runtime-field">
              <span>版本</span>
              <div className="runtime-install">
                <select
                  aria-label="npm 包版本"
                  disabled={busy}
                  value={version}
                  onChange={e => setVersion(e.target.value)}
                >
                  {versions.map(v => <option key={v}>{v}</option>)}
                </select>
                <button
                  className="secondary-button"
                  disabled={busy || !version || state?.packages[name]?.versions.includes(version)}
                  onClick={() => void perform("install")}
                >
                  {state?.packages[name]?.versions.includes(version) ? "已安装" : "安装"}
                </button>
              </div>
            </label>
          )}
          <div className="runtime-download-source">
            {state && <DownloadSource value={state.registry} disabled={busy} onChange={source} />}
          </div>
        </div>
        <div hidden={installMode !== "local"}>
          <p className="muted-note">
            .tgz 使用 npm pack 的输出；包目录需有 package.json、源码和所需 node_modules。依赖也可先单独安装。
          </p>
          <div className="runtime-version-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void perform("import", name, version, true)}
            >
              导入 .tgz
            </button>
            <button className="secondary-button" disabled={busy} onClick={() => void perform("import")}>
              导入目录
            </button>
          </div>
        </div>
      </RuntimeSection>
      <RuntimeSection title="已安装包">
        <input
          type="search"
          className="runtime-package-search"
          aria-label="筛选已安装 npm 包"
          placeholder="筛选已安装包"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        {installed.map(([pkg, entry]) => (
          <div className="runtime-installed" key={pkg}>
            <code>{pkg}</code>
            <div className="runtime-package-actions">
              <select
                aria-label={pkg + " 版本"}
                value={entry.selected}
                disabled={busy}
                onChange={e => void perform("select", pkg, e.target.value)}
              >
                {entry.versions.map(v => <option key={v}>{v}</option>)}
              </select>
              {confirm === pkg
                ? (
                  <>
                    <button
                      className="runtime-danger"
                      disabled={busy}
                      onClick={() => void perform("remove", pkg, entry.selected)}
                    >
                      确认卸载
                    </button>
                    <button disabled={busy} onClick={() => setConfirm("")}>取消</button>
                  </>
                )
                : <button disabled={busy} onClick={() => setConfirm(pkg)}>卸载</button>}
            </div>
          </div>
        ))}
        {!installed.length && <p className="runtime-empty">{filter ? "没有匹配的包" : "尚未安装依赖"}</p>}
      </RuntimeSection>
      {!state && error && <p className="feature-error" role="alert">{error}</p>}
    </div>
  );
}
