import { isComposingKey } from '../keyboardComposition';
import { Clock3, RotateCcw, RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../bridge";
import { fileKind } from "../fileKinds";
import { HistoryDiff } from "./HistoryDiff";
import "./documentHistory.css";
interface Entry {
  id: string;
  time: number;
  bytes: number;
  reason: "saved" | "before" | "restore";
}
interface Listing {
  enabled: boolean;
  retentionDays: number;
  entries: Entry[];
  interval: number;
  limit: number;
  maxText: number;
}
const date = (time: number) =>
  new Date(time).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
export function DocumentHistory({ root, document, version, content, readOnly, flush, restore }: {
  root: string;
  document: string;
  version?: string;
  content: string;
  readOnly?: boolean;
  flush(): void;
  restore(id: string): Promise<void>;
}) {
  const supported = !!document && ["markdown", "text", "html"].includes(fileKind(document))
    && !document.startsWith(".data/");
  const [listing, setListing] = useState<Listing | null>(null),
    [refresh, setRefresh] = useState(0),
    [selection, setSelection] = useState<{ id: string; time: number; content: string } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const ticket = useRef(0), live = useRef(true);
  useEffect(() => {
    const changed = () => setRefresh(value => value + 1);
    window.addEventListener("moyu-history-settings", changed);
    return () => window.removeEventListener("moyu-history-settings", changed);
  }, []);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      ticket.current++;
    };
  }, []);
  useEffect(() => {
    if (selection) {
      window.document.querySelector<HTMLButtonElement>(".document-history-view [aria-label=\"关闭历史比较\"]")?.focus();
    }
  }, [selection?.id]);
  useEffect(() => {
    let alive = true;
    if (!supported) {
      setListing(null);
      return;
    }
    void api.feature<Listing>("file.history-list", { root, document }).then(value => {
      if (alive) {
        setListing(value);
        setError("");
      }
    }).catch(error => {
      if (alive) setError(error.message);
    });
    return () => {
      alive = false;
    };
  }, [root, document, version, refresh, supported]);
  const inspect = async (id: string) => {
    if (busy) return;
    const request = ++ticket.current;
    flush();
    setBusy(true);
    setError("");
    try {
      if (new TextEncoder().encode(content).byteLength > (listing?.maxText || 2 * 1024 * 1024)) {
        throw Error("当前文档超过 2 MB，暂不支持历史比较。");
      }
      const selected = await api.feature<{ id: string; time: number; content: string }>("file.history-read", {
        root,
        document,
        id,
      });
      if (live.current && request === ticket.current) setSelection(selected);
    } catch (error) {
      if (live.current) setError((error as Error).message);
    } finally {
      if (live.current && request === ticket.current) setBusy(false);
    }
  };
  const recover = async () => {
    if (!selection || busy) return;
    setBusy(true);
    setError("");
    try {
      await restore(selection.id);
      if (live.current) {
        setSelection(null);
        setRefresh(value => value + 1);
      }
    } catch (error) {
      if (live.current) setError((error as Error).message);
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const main = document ? window.document.querySelector(".main-area") : null;
  return (
    <div className="document-history">
      <div className="history-owner">
        <strong title={document}>{document.split("/").pop() || "未打开文档"}</strong>
        <button
          className="icon-button"
          aria-label="刷新文档历史"
          title="刷新"
          disabled={busy || !supported}
          onClick={() => setRefresh(value => value + 1)}
        >
          <RotateCw size={14} />
        </button>
      </div>
      {error && !selection && <p role="alert" className="history-error">{error}</p>}
      {supported && listing?.entries.length
        ? (
          <ol className="history-entries">
            {listing.entries.map(entry => (
              <li key={entry.id}>
                <button
                  disabled={busy}
                  aria-current={selection?.id === entry.id ? "true" : undefined}
                  title={new Date(entry.time).toLocaleString()}
                  onClick={() => void inspect(entry.id)}
                >
                  <Clock3 size={14} />
                  <span>
                    <time dateTime={new Date(entry.time).toISOString()}>{date(entry.time)}</time>
                    <small>
                      {entry.reason === "before" ? "修改前" : entry.reason === "restore" ? "恢复前" : "保存"}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )
        : (
          <p className="history-empty">
            {!document
              ? "打开文档查看历史"
              : !supported
              ? "此文件不支持文档历史"
              : listing
              ? "保存修改后显示历史版本"
              : "正在读取…"}
          </p>
        )}
      {supported && listing && (
        <p className="history-policy">
          {listing.enabled ? <>保存时记录，间隔 {listing.interval / 60000} 分钟。</> : "不记录保存版本。"} 最多{" "}
          {listing.limit} 个版本，保留 {listing.retentionDays} 天。
        </p>
      )}
      {selection && main
        && createPortal(
          <section
            className="document-history-view"
            aria-label="文档历史比较"
            onKeyDown={event => {
              if (event.key === "Escape" && !isComposingKey(event) && !busy) {
                event.stopPropagation();
                setSelection(null);
                setError("");
              }
            }}
          >
            <header className="history-view-toolbar">
              <div>
                <strong>{document.split("/").pop()}</strong>
                <span>{date(selection.time)}</span>
              </div>
              {selection.content === content && <small>与当前内容相同</small>}
              <button
                className="secondary-button"
                disabled={busy || readOnly || selection.content === content}
                onClick={() => void recover()}
              >
                <RotateCcw size={14} />恢复此版本
              </button>
              <button
                className="icon-button"
                title="返回文档"
                aria-label="关闭历史比较"
                disabled={busy}
                onClick={() => {
                  setSelection(null);
                  setError("");
                }}
              >
                <X size={16} />
              </button>
            </header>
            {error && <p role="alert" className="history-error">{error}</p>}
            <HistoryDiff left={selection.content} right={content} />
          </section>,
          main,
        )}
    </div>
  );
}
