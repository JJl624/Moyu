import { useEffect, useState } from "react";
import { api } from "./bridge";
import { DownloadSource } from "./DownloadSource";
import { RuntimeAssetSource } from "./runtime-settings/RuntimeAssetSource";
import { RuntimeInstaller } from "./runtime-settings/RuntimeInstaller";
import { type RuntimeNotice, RuntimeSection, RuntimeVersions } from "./runtime-settings/RuntimeLayout";
import { runtimeNotice } from '../shared/runtime-notice.mjs';
type State = {
  registry: string;
  selected: string;
  recommended: string;
  assetSource?: string;
  assetMirror?: string;
  versions: string[];
  versionLabels?: Record<string, string>;
  upstreamChanged?: boolean;
  installed: { version: string; name: string; size: number }[];
};
export function RuntimeManager(
  { language, onChange, onNotice, onBusy }: {
    language: "clang" | "sql" | "lua" | "csharp" | "java" | "ruby" | "bash";
    onChange(): void;
    onNotice(notice: RuntimeNotice): void;
    onBusy(busy: boolean): void;
  },
) {
  const [state, setState] = useState<State | null>(null),
    [version, setVersion] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const receive = (value: State) => {
    setState(value);
    setVersion(previous => value.versions.includes(previous) ? previous : value.selected || value.recommended);
  };
  useEffect(() => {
    let alive = true;
    void api.feature<State>("runtime.state", { language }).then(value => {
      if (alive) receive(value);
    }).catch(e => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
    };
  }, [language]);
  const action = async (action: string, selected = version, token?: string) => {
    setBusy(action);
    onBusy(true);
    onNotice(null);
    setError("");
    try {
      const value = await api.feature<State>("runtime." + action, { language, version: selected, token });
      receive(value);
      if (action === "select") setVersion(selected);
      if (action === "import-files" || action === "import") setVersion(value.selected || selected);
      onChange();
      if (action !== "import" || value.installed.length > (state?.installed.length || 0)) {
        onNotice({
          text: action === 'refresh' && value.upstreamChanged
            ? '下载源版本已变更，暂不可安装新版' : runtimeNotice(action),
        });
      }
    } catch (e) {
      if ((e as { code?: string }).code !== "DOWNLOAD_CANCELLED") {
        setError((e as Error).message);
        onNotice({ text: (e as Error).message, error: true });
      }
    } finally {
      setBusy("");
      onBusy(false);
    }
  };
  const source = async (registry: string) => {
    setBusy("source");
    onBusy(true);
    onNotice(null);
    setError("");
    try {
      receive(await api.feature<State>("runtime.configure", { language, registry }));
    } catch (e) {
      setError((e as Error).message);
      onNotice({ text: (e as Error).message, error: true });
    } finally {
      setBusy("");
      onBusy(false);
    }
  };
  return (
    <div className="runtime-manager" aria-busy={!!busy}>
      <RuntimeSection title="已安装环境">
        <RuntimeVersions
          versions={(state?.installed || []).map(item => ({
            version: item.version,
            label: state?.versionLabels?.[item.version],
          }))}
          selected={state?.selected || ""}
          busy={!!busy}
          use={version => void action("select", version)}
          remove={version => action("remove", version)}
          reveal={version =>
            void api.feature("runtime.reveal", { language, version }).catch(e =>
              onNotice({ text: e.message, error: true })
            )}
        />
      </RuntimeSection>
      <RuntimeInstaller
        sourceKey={JSON.stringify([state?.registry, state?.assetMirror, state?.installed])}
        version={version}
        checking={value => {
          setBusy(value ? "verify-files" : "");
          onBusy(value);
        }}
        importFiles={token => action("import-files", version, token)}
        installed={state?.installed.map(item => item.version) || []}
        language={language}
        busy={!!busy}
        refresh={
          <button
            className="text-button"
            disabled={!!busy}
            onClick={() => void action("refresh")}
          >
            {busy === "refresh" ? "正在刷新…" : "刷新版本"}
          </button>
        }
        online={
          <>
            <label className="runtime-field">
              <span>可用版本</span>
              <div className="runtime-install">
                <select
                  aria-label="运行环境版本"
                  value={version}
                  disabled={!!busy || !state}
                  onChange={e => setVersion(e.target.value)}
                >
                  {state?.versions.map(v => <option key={v} value={v}>{state.versionLabels?.[v] || v}</option>)}
                </select>
                <button
                  className="secondary-button"
                  disabled={!!busy || !version || state?.installed.some(v => v.version === version)}
                  onClick={() => void action("install")}
                >
                  {busy === "install"
                    ? "安装中…"
                    : state?.installed.some(v => v.version === version)
                    ? "已安装"
                    : "安装"}
                </button>
              </div>
            </label>
            <div className="runtime-download-source">
              {state && (
                <DownloadSource
                  label={state.assetSource ? "格式化插件下载源" : "npm 下载源"}
                  value={state.registry}
                  disabled={!!busy}
                  onChange={source}
                />
              )}
              {state?.assetSource && (
                <RuntimeAssetSource
                  language={language}
                  official={state.assetSource}
                  value={state.assetMirror || ""}
                  busy={!!busy}
                  change={async value => {
                    setBusy("source");
                    onBusy(true);
                    try {
                      receive(
                        await api.feature<State>("runtime.configure", { language, assetMirror: value }),
                      );
                    } finally {
                      setBusy("");
                      onBusy(false);
                    }
                  }}
                />
              )}
            </div>
          </>
        }
        importEnvironment={token => action("import", version, token)}
      />

      {!state && error && <p className="feature-error" role="alert">{error}</p>}
    </div>
  );
}
