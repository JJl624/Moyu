import { useEffect, useState } from "react";
import { api } from "./bridge";
import { usePreferenceDraft } from "./preferenceDraft";
import "./runtimePreferences.css";
import { DownloadProgress } from "./DownloadProgress";
import { JavaScriptDependencies } from "./JavaScriptDependencies";
import { RuntimeLayout, RuntimeSection, type RuntimeNotice } from "./runtime-settings/RuntimeLayout";
import { RuntimeManager } from "./RuntimeManager";
interface RuntimeConfig {
  executionTimeoutSeconds: number;
  preparationTimeoutSeconds: number;
  autoMain?: boolean;
  multiFile?: boolean;
  stdinFile?: string;
  cStandard?: string;
  cppStandard?: string;
  cHeaders?: string[];
  cppHeaders?: string[];
  databaseFile?: string;
  foreignKeys?: boolean;
  maxRows?: number;
  enableModules?: boolean;
  usings?: string[];
  mainClass?: string;
  optimizationLevel?: string;
  maxCommands?: number;
  maxLoopIterations?: number;
  memoryLimitMB?: number;
}
interface RuntimeState {
  settings: RuntimeConfig;
  defaults: RuntimeConfig;
  runtime: { name: string; version: string; electron?: string };
  file: string;
  cStandards: string[];
  cppStandards: string[];
  headers?: { c: string[]; cpp: string[] };
}
const parseHeaders = (text: string) => [...new Set(text.split(/[,\s]+/).filter(Boolean))];
export function RuntimePreferences(
  { language }: { language: "javascript" | "clang" | "sql" | "lua" | "csharp" | "java" | "ruby" | "bash" },
) {
  const [state, setState] = useState<RuntimeState | null>(null);
  const draft = usePreferenceDraft<RuntimeConfig | null>(language, null, async value => {
    if (value) await api.feature("code.runtime-configure", { language, settings: value });
  }, () => {
    setHeaderText({});
    return state?.defaults || null;
  });
  const config = draft.value;
  const [filter, setFilter] = useState({ c: "", cpp: "" });
  const headers = { c: (config?.cHeaders || []).join(", "), cpp: (config?.cppHeaders || []).join(", ") };
  const [headerText, setHeaderText] = useState<{ c?: string; cpp?: string; csharp?: string }>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState<RuntimeNotice>(null),
    [environmentBusy, setEnvironmentBusy] = useState(false),
    [clangKind, setClangKind] = useState<"c" | "cpp">("c");
  const clang = language === "clang",
    title = clang
      ? "C / C++"
      : language === "sql"
      ? "SQL"
      : language === "lua"
      ? "Lua"
      : language === "csharp"
      ? "C#"
      : language === "java"
      ? "Java"
      : language === "ruby"
      ? "Ruby"
      : language === "bash"
      ? "Bash"
      : "JavaScript / TypeScript";
  const receive = (next: RuntimeState) => {
    setState(next);
    draft.load(next.settings);
    setHeaderText({});
  };
  useEffect(() => {
    let cancelled = false;
    if (api.desktop) {
      void api.feature<RuntimeState>("code.runtime-state", { language })
        .then(next => {
          if (!cancelled) receive(next);
        }).catch(e => {
          if (!cancelled) setError(e.message);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [language]);
  const change = (patch: Partial<RuntimeConfig>) => {
    setError("");
    setNotice(null);
    draft.set(value => value && { ...value, ...patch });
  };
  const changeHeaders = (kind: "c" | "cpp", text: string) => {
    setHeaderText(value => ({ ...value, [kind]: text }));
    change({ [kind === "c" ? "cHeaders" : "cppHeaders"]: parseHeaders(text) });
  };
  const reset = async () => {
    setBusy(true);
    setError("");
    try {
      await draft.commit();
      await api.feature("code.runtime-reset", { language });
      setNotice({ text: "已重启" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!api.desktop) return <p className="muted-note">代码运行设置需要桌面应用。</p>;
  if (!config || !state) return <p role={error ? "alert" : "status"}>{error || "加载中…"}</p>;
  const settings = (
    <>
      {["csharp", "java"].includes(language) && (
        <RuntimeSection title="编译与输入">
          <div className="pref-row">
            <span>编译数据目录中的源文件</span>
            <button
              role="switch"
              className={"toggle " + (config.multiFile ? "on" : "")}
              aria-label="编译数据目录中的源文件"
              aria-checked={config.multiFile}
              onClick={() => change({ multiFile: !config.multiFile })}
            >
              <span />
            </button>
          </div>
          {language === "csharp"
            ? (
              <>
                <label className="runtime-field">
                  <span>默认 using</span>
                  <input
                    aria-label="C# 默认 using"
                    value={headerText.csharp ?? (config.usings || []).join(", ")}
                    onChange={e => {
                      setHeaderText(v => ({ ...v, csharp: e.target.value }));
                      change({ usings: parseHeaders(e.target.value) });
                    }}
                  />
                </label>
                <label className="runtime-field">
                  <span>标准输入文件</span>
                  <input
                    aria-label="C# 标准输入文件"
                    value={config.stdinFile || ""}
                    onChange={e => change({ stdinFile: e.target.value })}
                  />
                </label>
              </>
            )
            : (
              <>
                <div className="pref-row">
                  <span>自动包裹代码片段</span>
                  <button
                    role="switch"
                    className={"toggle " + (config.autoMain ? "on" : "")}
                    aria-label="自动包裹代码片段"
                    aria-checked={config.autoMain}
                    onClick={() => change({ autoMain: !config.autoMain })}
                  >
                    <span />
                  </button>
                </div>
                <label className="runtime-field">
                  <span>主类</span>
                  <input
                    aria-label="Java 主类"
                    placeholder="自动检测"
                    value={config.mainClass || ""}
                    onChange={e => change({ mainClass: e.target.value })}
                  />
                </label>
              </>
            )}
        </RuntimeSection>
      )}
      {["ruby", "bash"].includes(language) && (
        <RuntimeSection title="输入与参数">
          <label className="runtime-field">
            <span>标准输入文件</span>
            <input
              aria-label={title + " 标准输入文件"}
              value={config.stdinFile || ""}
              onChange={e => change({ stdinFile: e.target.value })}
            />
          </label>
        </RuntimeSection>
      )}
      {language === "bash" && (
        <RuntimeSection title="资源限制">
          {([["maxCommands", "命令数量上限", 1, 10000000], [
            "maxLoopIterations",
            "循环次数上限",
            1,
            10000000,
          ], ["memoryLimitMB", "内存上限（MB）", 16, 256]] as const).map(([key, label, min, max]) => (
            <label className="pref-row" key={key}>
              <span>{label}</span>
              <input
                type="number"
                aria-label={"Bash " + label}
                min={min}
                max={max}
                value={Number.isNaN(config[key]) ? "" : config[key]}
                onChange={e =>
                  change({ [key]: e.target.value === "" ? NaN : Number(e.target.value) })}
              />
            </label>
          ))}
        </RuntimeSection>
      )}
      {clang && (
        <>
          <RuntimeSection title="代码片段">
            <div className="pref-row">
              <span>缺少 main 时自动包裹</span>
              <button
                role="switch"
                className={"toggle " + (config.autoMain ? "on" : "")}
                aria-label="缺少 main 时自动包裹"
                aria-checked={config.autoMain}
                disabled={busy}
                onClick={() => change({ autoMain: !config.autoMain })}
              >
                <span />
              </button>
            </div>
            <div className="pref-row">
              <span>编译数据目录中的源文件</span>
              <button
                role="switch"
                className={"toggle " + (config.multiFile ? "on" : "")}
                aria-label="编译数据目录中的源文件"
                aria-checked={config.multiFile}
                disabled={busy}
                onClick={() => change({ multiFile: !config.multiFile })}
              >
                <span />
              </button>
            </div>
            <label className="runtime-field">
              <span>标准输入文件</span>
              <input
                aria-label="C / C++ 标准输入文件"
                value={config.stdinFile || ""}
                disabled={busy}
                placeholder="stdin.txt"
                onChange={e => change({ stdinFile: e.target.value })}
              />
            </label>
            <p className="muted-note">scanf / cin 从此文件读取；留空或文件不存在时无输入。</p>
          </RuntimeSection>
          <div className="clang-settings-tabs" role="group" aria-label="C/C++ 设置">
            {(["c", "cpp"] as const).map(kind => (
              <button
                key={kind}
                aria-pressed={clangKind === kind}
                onClick={() => void draft.commit().then(() => setClangKind(kind)).catch(() => {})}
              >
                {kind === "c" ? "C" : "C++"}
              </button>
            ))}
          </div>
          {(["c", "cpp"] as const).filter(kind => kind === clangKind).map(kind => {
            const label = kind === "c" ? "C" : "C++",
              standardKey = kind === "c" ? "cStandard" : "cppStandard";
            const selected = parseHeaders(headers[kind]);
            return (
              <RuntimeSection key={kind} title={label}>
                <label className="pref-row">
                  <span>语言标准</span>
                  <select
                    aria-label={label + " 语言标准"}
                    value={config[standardKey]}
                    disabled={busy}
                    onChange={e => change({ [standardKey]: e.target.value })}
                  >
                    {(kind === "c" ? state.cStandards : state.cppStandards).map(standard => (
                      <option key={standard} value={standard}>
                        {standard.startsWith("gnu")
                          ? "GNU C" + standard.slice(3)
                          : standard.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="runtime-field">
                  <span>默认头文件</span>
                  <input
                    aria-label={label + " 默认头文件"}
                    value={headerText[kind] ?? headers[kind]}
                    disabled={busy}
                    placeholder={kind === "c" ? "stdio.h, stdlib.h" : "iostream, vector"}
                    onChange={e => changeHeaders(kind, e.target.value)}
                  />
                </label>
                <details className="runtime-header-picker">
                  <summary>
                    选择头文件 <span>{selected.length} 个已选</span>
                  </summary>
                  <label className="runtime-header-filter">
                    <input
                      aria-label={label + " 筛选头文件"}
                      placeholder="筛选头文件"
                      value={filter[kind]}
                      onChange={e => setFilter({ ...filter, [kind]: e.target.value })}
                    />
                  </label>
                  <div className="runtime-header-list" aria-label={label + " 可用头文件"}>
                    {state.headers?.[kind].filter(h => h.toLowerCase().includes(filter[kind].toLowerCase()))
                      .map(header => (
                        <label key={header}>
                          <input
                            type="checkbox"
                            checked={selected.includes(header)}
                            disabled={busy}
                            onChange={() =>
                              changeHeaders(
                                kind,
                                (selected.includes(header)
                                  ? selected.filter(v => v !== header)
                                  : [...selected, header]).join(", "),
                              )}
                          />
                          <code>{header}</code>
                        </label>
                      ))}
                  </div>
                </details>
                <small className="muted-note">头文件来自 WASI 工具链。</small>
              </RuntimeSection>
            );
          })}
        </>
      )}
      {language === "sql" && (
        <RuntimeSection title="数据库">
          <label className="runtime-field">
            <span>数据库文件名</span>
            <input
              aria-label="SQL 数据库文件名"
              value={config.databaseFile || ""}
              disabled={busy}
              onChange={e => change({ databaseFile: e.target.value })}
            />
          </label>
          <label className="pref-row">
            <span>检查外键约束</span>
            <button
              role="switch"
              className={"toggle " + (config.foreignKeys ? "on" : "")}
              aria-label="检查外键约束"
              aria-checked={config.foreignKeys}
              disabled={busy}
              onClick={() => change({ foreignKeys: !config.foreignKeys })}
            >
              <span />
            </button>
          </label>
          <label className="pref-row">
            <span>每个查询的显示行数上限</span>
            <input
              aria-label="SQL 查询行数上限"
              type="number"
              min={1}
              max={1000}
              step={1}
              value={Number.isNaN(config.maxRows) ? "" : config.maxRows}
              disabled={busy}
              onChange={e => change({ maxRows: e.target.value === "" ? NaN : Number(e.target.value) })}
            />
          </label>
        </RuntimeSection>
      )}
      {language === "lua" && (
        <RuntimeSection title="文件与模块">
          <label className="runtime-field">
            <span>标准输入文件</span>
            <input
              aria-label="Lua 标准输入文件"
              value={config.stdinFile || ""}
              disabled={busy}
              onChange={e => change({ stdinFile: e.target.value })}
            />
          </label>
          <label className="pref-row">
            <span>允许 require 本地模块</span>
            <button
              role="switch"
              className={"toggle " + (config.enableModules ? "on" : "")}
              aria-label="允许 require 本地模块"
              aria-checked={config.enableModules}
              disabled={busy}
              onClick={() => change({ enableModules: !config.enableModules })}
            >
              <span />
            </button>
          </label>
        </RuntimeSection>
      )}
      {clang && (
        <RuntimeSection title="编译设置">
          {clang && (
            <label className="runtime-field">
              <span>编译优化</span>
              <select
                aria-label="C / C++ 编译优化"
                value={config.optimizationLevel || "default"}
                onChange={e => change({ optimizationLevel: e.target.value })}
              >
                {[
                  ["default", "工具链默认"],
                  ["O0", "O0 无优化"],
                  ["O1", "O1 基础优化"],
                  ["O2", "O2 运行性能"],
                  ["O3", "O3 进一步优化"],
                  ["Os", "Os 代码体积"],
                  ["Oz", "Oz 最小体积"],
                ].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          )}
        </RuntimeSection>
      )}
      <RuntimeSection title="运行时限">
        {(["executionTimeoutSeconds", "preparationTimeoutSeconds"] as const).map(key => (
          <label className="pref-row" key={key}>
            <span>
              {key === "executionTimeoutSeconds"
                ? "代码执行时限（秒）"
                : clang
                ? "编译与准备时限（秒）"
                : "环境准备时限（秒）"}
            </span>
            <input
              type="number"
              aria-label={title + (key === "executionTimeoutSeconds" ? " 代码执行时限" : " 准备时限")}
              min={1}
              max={3600}
              step={1}
              value={Number.isNaN(config[key]) ? "" : config[key]}
              disabled={busy}
              onChange={e =>
                change({ [key]: e.target.value === "" ? NaN : Number(e.target.value) })}
            />
          </label>
        ))}
      </RuntimeSection>
    </>
  );
  const environment = language === "javascript"
    ? (
      <>
        <RuntimeSection title="内置环境">
          <p>{state.runtime.name} {state.runtime.version}</p>
          <p className="muted-note">随应用更新</p>
        </RuntimeSection>
      </>
    )
    : (
      <RuntimeManager
        language={language}
        onNotice={notice => { setError(''); setNotice(notice); }}
        onBusy={setEnvironmentBusy}
        onChange={() => {
          void api.feature<RuntimeState>("code.runtime-state", { language }).then(next => setState(next)).catch(e =>
            setError(e.message)
          );
        }}
      />
    );
  return (
    <div
      className="runtime-preferences"
      {...draft.events}
      onChange={event => {
        const target = event.target as HTMLInputElement;
        if (target.tagName === "SELECT" || target.type === "checkbox") draft.apply();
      }}
      onClick={event => {
        if ((event.target as Element).closest("[role=switch]")) draft.apply();
      }}
    >
      <RuntimeLayout
        title={title}
        summary={state.runtime.name + (state.runtime.version === "未安装" ? "" : " " + state.runtime.version)}
        ready={state.runtime.version !== "未安装"}
        beforeChange={draft.commit}
        busy={busy || environmentBusy}
        restart={() => void reset()}
        notice={error || draft.error ? { text: error || draft.error, error: true } : notice}
        progress={language === "javascript"
          ? <DownloadProgress scope="javascript" />
          : <DownloadProgress scope={"runtime:" + language} />}
        panels={[
          { id: "settings", label: "运行设置", content: settings },
          {
            id: "environment",
            label: "环境",
            content: (
              <>
                {environment}
                <section className="runtime-location">
                  <h4>配置文件</h4>
                  <p className="runtime-config-path">{state.file}</p>
                </section>
              </>
            ),
          },
          ...(language === "javascript"
            ? [{
              id: "dependencies",
              label: "依赖",
              content: <JavaScriptDependencies onNotice={notice => { setError(''); setNotice(notice); }} onBusy={setEnvironmentBusy} />,
            }]
            : []),
        ]}
      />
      {draft.saving && <small role="status">正在应用…</small>}
    </div>
  );
}
