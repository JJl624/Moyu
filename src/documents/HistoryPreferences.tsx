import { HISTORY_DEFAULTS, type HistoryOptions, storedHistoryOptions } from "../../shared/history-options.mjs";
import { api } from "../bridge";
import { NumberField } from "../NumberField";
import { usePreferenceDraft } from "../preferenceDraft";
import { settingsStore } from "../settingsStore";
export function HistoryPreferences() {
  const draft = usePreferenceDraft(
    "history",
    storedHistoryOptions(settingsStore.getItem("moyu-history")),
    async settings => {
      await api.feature("history.configure", { settings });
      settingsStore.acceptItem("moyu-history", JSON.stringify(settings));
      window.dispatchEvent(new Event("moyu-history-settings"));
    },
    () => ({ ...HISTORY_DEFAULTS }),
  );
  const set = (key: keyof HistoryOptions, value: boolean | number) =>
    draft.set(previous => ({ ...previous, [key]: value }));
  return (
    <section className="history-preferences" {...draft.events}>
      <h3>文档历史</h3>
      <div className="pref-row">
        <span>保存历史版本</span>
        <button
          role="switch"
          aria-label="保存历史版本"
          aria-checked={draft.value.enabled}
          className={"toggle" + (draft.value.enabled ? " on" : "")}
          onClick={() => {
            set("enabled", !draft.value.enabled);
            draft.apply();
          }}
        >
          <span />
        </button>
      </div>
      {draft.value.enabled && (
        <>
          <label className="pref-row">
            <span>记录间隔（分钟）</span>
            <NumberField
              label="历史记录间隔"
              value={draft.value.intervalMinutes}
              min={1}
              max={60}
              change={value => set("intervalMinutes", Math.round(value))}
            />
          </label>
          <label className="pref-row">
            <span>每篇文档版本数上限</span>
            <NumberField
              label="历史保留版本数"
              value={draft.value.maxEntries}
              min={5}
              max={100}
              change={value => set("maxEntries", Math.round(value))}
            />
          </label>
          <label className="pref-row">
            <span>保留天数</span>
            <NumberField
              label="历史保留天数"
              value={draft.value.retentionDays}
              min={1}
              max={365}
              change={value => set("retentionDays", Math.round(value))}
            />
          </label>
        </>
      )}
      <p className="muted-note">只记录保存后的修改。恢复前另存当前内容；附件和代码数据不回退。</p>
      {draft.error && <p role="alert" className="feature-error">{draft.error}</p>}
    </section>
  );
}
