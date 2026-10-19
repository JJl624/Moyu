import { useEffect, useState } from "react";
import { api } from "./bridge";
import "./downloadProgress.css";
export interface DownloadState {
  id: string;
  scope: string;
  label: string;
  status: "running" | "cancelling" | "cancelled" | "completed" | "failed";
  phase: string;
  file: string;
  received: number;
  total: number | null;
  transferred: number;
  cancellable: boolean;
}
const size = (n: number) => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB";
export function DownloadProgress({ scope }: { scope: string }) {
  const [state, setState] = useState<DownloadState | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let alive = true, changed = false;
    setState(null);
    const off = api.onDownload?.(state => {
      if (state.scope === scope && alive) {
        changed = true;
        setState(state);
        setError("");
      }
    });
    if (api.desktop) {
      void api.feature<DownloadState | null>("downloads.state", { scope }).then(state => {
        if (alive && !changed) setState(state);
      }).catch(() => {});
    }
    return () => {
      alive = false;
      off?.();
    };
  }, [scope]);
  if (!state || !["running", "cancelling", "cancelled"].includes(state.status)) return null;
  if (state.status === "cancelled") {
    return (
      <p className="muted-note download-cancelled" role="status">
        {state.label.includes("导入") ? "已取消导入" : /安装|下载/.test(state.label) ? "已取消下载" : "已取消"}
      </p>
    );
  }
  const transferring = ["下载", "复制与校验", "校验文件"].includes(state.phase), known = transferring && state.total !== null;
  return (
    <div className="download-progress" role="status">
      <div className="download-progress-heading">
        <span>{state.status === "cancelling" ? "正在取消…" : state.phase === "下载" ? state.label : state.phase}</span>
        <button
          className="text-button"
          disabled={!state.cancellable || state.status === "cancelling"}
          onClick={() => void api.feature("downloads.cancel", { scope, id: state.id }).catch(e => setError(e.message))}
        >
          取消
        </button>
      </div>
      <progress
        aria-label={state.label + "进度"}
        {...known ? { max: state.total!, value: Math.min(state.received, state.total!) } : {}}
      />
      {state.file && (
        <small title={state.file}>
          {state.file}
          {transferring ? " " + size(state.received) + (known ? " / " + size(state.total!) : "") : ""}
        </small>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
