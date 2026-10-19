import { Pin, PinOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "./bridge";
import { HTMLResizeHandle } from "./HTMLResizeHandle";
import "./htmlResults.css";
import { htmlWasStarted, markHTMLStarted, registerHTMLSession } from "./htmlResultLifecycle";
export function HTMLResult(
  { token, path, pinned: initialPinned = false, height: initialHeight = 360 }: {
    token: string;
    path: string;
    pinned?: boolean;
    height?: number;
  },
) {
  const frame = useRef<HTMLIFrameElement>(null),
    [url, setURL] = useState(""),
    [revision, setRevision] = useState(0),
    [stopped, setStopped] = useState(false),
    [status, setStatus] = useState("正在加载…"),
    [logs, setLogs] = useState(""),
    [error, setError] = useState("");
  const [pinned, setPinned] = useState(initialPinned),
    [height, setHeight] = useState(initialHeight),
    [pinBusy, setPinBusy] = useState(false);
  const heightRef = useRef(initialHeight), dragging = useRef(false), sizeRevision = useRef(0);
  const canvas = useRef<HTMLDivElement>(null),
    pin = useRef(initialPinned),
    sizeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    pendingSize = useRef<number | undefined>(undefined),
    sizeSaving = useRef(Promise.resolve());
  pin.current = pinned;
  const publishPin = (state: { pinned: boolean; height: number }) => {
    if (state.pinned && state.height !== heightRef.current) {
      pendingSize.current = heightRef.current;
      flushSize();
    }
    setPinned(state.pinned);
    pin.current = state.pinned;
    state = { ...state, height: heightRef.current };
    window.dispatchEvent(new CustomEvent("moyu-html-pin-changed", { detail: { token, ...state } }));
  };
  const flushSize = () => {
    clearTimeout(sizeTimer.current);
    if (pendingSize.current === undefined) return;
    const height = pendingSize.current;
    pendingSize.current = undefined;
    sizeSaving.current = sizeSaving.current.then(() => api.feature("code.html-resize", { token, height }))
      .then(() => {}).catch(e => setError(e.message));
  };
  const resizeResult = (value: number, finished: boolean) => {
    dragging.current = !finished;
    sizeRevision.current++;
    heightRef.current = value;
    setHeight(value);
    if (canvas.current) canvas.current.style.height = value + "px";
    if (finished && pin.current) {
      window.dispatchEvent(
        new CustomEvent("moyu-html-pin-changed", { detail: { token, pinned: true, height: value } }),
      );
      pendingSize.current = value;
      flushSize();
    }
  };
  const togglePin = async () => {
    setPinBusy(true);
    try {
      publishPin(
        await api.feature("code.html-pin", { token, pinned: !pin.current, height: heightRef.current }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPinBusy(false);
    }
  };
  const recover = async (error: string) => {
    try {
      const artifact = await api.feature("code.html-pin-recover", { token });
      if (artifact) {
        window.dispatchEvent(new CustomEvent("moyu-html-pin-failed", { detail: { token, artifact, error } }));
      }
    } catch { /* Keep the failed result available when recovery is unavailable. */ }
  };
  useEffect(() => {
    let alive = true;
    const generation = sizeRevision.current;
    void api.feature<{ pinned: boolean; height: number }>("code.html-pin-state", { token }).then(state => {
      if (alive) {
        setPinned(state.pinned);
        pin.current = state.pinned;
        if (generation === sizeRevision.current) {
          setHeight(state.height);
          heightRef.current = state.height;
        }
      }
    }).catch(() => {});
    return () => {
      alive = false;
      flushSize();
    };
  }, [token]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const height = Math.round(element.getBoundingClientRect().height);
      if (dragging.current || height < 160 || height === heightRef.current) return;
      sizeRevision.current++;
      heightRef.current = height;
      setHeight(height);
      if (pin.current) {
        window.dispatchEvent(
          new CustomEvent("moyu-html-pin-changed", { detail: { token, pinned: true, height } }),
        );
        pendingSize.current = height;
        clearTimeout(sizeTimer.current);
        sizeTimer.current = setTimeout(flushSize, 300);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [token, url, stopped]);
  const view = useRef("");
  view.current = url ? new URL(url).hostname : "";
  const settle = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let alive = true;
    if (!revision && !initialPinned && htmlWasStarted(token)) {
      setStopped(true);
      setStatus("已暂停");
      return;
    }
    setStopped(false);
    setLogs("");
    setError("");
    setStatus("正在加载…");
    void api.feature<string>("code.html-url", { token, reload: revision > 0 }).then(url => {
      if (alive) setURL(url + "?run=" + revision);
    }).catch(e => {
      if (alive) {
        setError(e.message);
        setStatus("加载失败");
      }
    });
    return () => {
      alive = false;
    };
  }, [token, revision]);
  useEffect(() => {
    if (stopped) return;
    let timer: ReturnType<typeof setTimeout> | undefined,
      filesTimer: ReturnType<typeof setTimeout> | undefined,
      pendingFiles: unknown;
    let alive = true, saving = Promise.resolve(), downloads = 0;
    const flush = () => {
      clearTimeout(filesTimer);
      if (!pendingFiles) return;
      const files = pendingFiles;
      pendingFiles = undefined;
      const id = view.current;
      saving = saving.then(() => api.feature("code.html-files", { token, view: id, files })).then(() => {
        if (alive) window.dispatchEvent(new Event("moyu-code-data-changed"));
      }).catch(e => {
        if (alive) setError(e.message);
      });
    };
    settle.current = async () => {
      flush();
      flushSize();
      await saving;
      await sizeSaving.current;
    };
    const unregister = registerHTMLSession(token, {
      document: path,
      settle: () => settle.current(),
      stop: () => {
        setStopped(true);
        setStatus("已暂停");
      },
    });
    const message = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data?.moyuHTML) return;
      const { type, value } = event.data;
      if (type === "ready") {
        setStatus("运行中");
        clearTimeout(timer);
        timer = setTimeout(() => {
          setStopped(true);
          setStatus("已停止");
          setError("代码执行超过时限。");
          void recover("代码执行超过时限。");
        }, Math.max(1000, Math.min(3600000, Number(value) || 10000)));
      } else if (type === "complete") {
        clearTimeout(timer);
        setStatus("");
        void api.feature<{ pinned: boolean; height: number; pending?: boolean }>("code.html-pin-state", {
          token,
        }).then(state =>
          state.pending
            ? api.feature<{ pinned: boolean; height: number }>("code.html-pin", {
              token,
              pinned: true,
              height: state.height,
            }).then(publishPin)
            : undefined
        ).catch(e => {
          if (alive) setError(e.message);
        });
      } else if (type === "error") {
        clearTimeout(timer);
        setError(String(value).slice(0, 8192));
        setStatus("运行出错");
        void recover(String(value).slice(0, 8192));
      } else if (type === "log") {
        setLogs(previous => (previous + String(value).slice(0, 65536) + "\n").slice(-65536));
      } else if (type === "files" && Array.isArray(value) && value.length <= 128) {
        pendingFiles = value;
        clearTimeout(filesTimer);
        filesTimer = setTimeout(flush, 300);
      } else if (type === "download" && Number.isSafeInteger(value?.id) && typeof value?.url === "string") {
        const source = frame.current?.contentWindow;
        if (downloads >= 4) {
          source?.postMessage({
            moyuHTML: true,
            type: "download-result",
            id: value.id,
            error: "同时读取的资源不能超过 4 个。",
          }, "*");
          return;
        }
        downloads++;
        void api.feature<string>("javascript.download", { token, view: view.current, url: value.url }).then(
          data => {
            if (alive && source === frame.current?.contentWindow) {
              source?.postMessage({ moyuHTML: true, type: "download-result", id: value.id, data }, "*");
            }
          },
        ).catch(e => {
          if (alive && source === frame.current?.contentWindow) {
            source?.postMessage(
              { moyuHTML: true, type: "download-result", id: value.id, error: e.message },
              "*",
            );
          }
        }).finally(() => {
          downloads--;
        });
      }
    };
    window.addEventListener("message", message);
    return () => {
      alive = false;
      clearTimeout(timer);
      flush();
      unregister();
      window.removeEventListener("message", message);
    };
  }, [token, revision, stopped]);
  return (
    <div className="html-result">
      <div className="html-result-toolbar">
        <span role="status">{status}</span>
        <button
          className="icon-button"
          aria-label={pinned ? "取消钉住 HTML" : "钉住 HTML"}
          title={pinned ? "取消钉住" : "钉住"}
          aria-pressed={pinned}
          disabled={pinBusy || !path}
          onClick={() => void togglePin()}
        >
          {pinned ? <PinOff size={14} /> : <Pin size={14} />}
        </button>
        <button
          onClick={() => {
            void settle.current().then(() => {
              setURL("");
              setRevision(v => v + 1);
            });
          }}
        >
          重新加载
        </button>
        <button
          disabled={stopped}
          onClick={() => {
            setStopped(true);
            setStatus("已停止");
          }}
        >
          停止
        </button>
      </div>
      {error && <pre className="html-result-error" role="alert">{error}</pre>}
      {!stopped && url && (
        <div className="html-result-canvas" ref={canvas} style={{ height }}>
          <iframe
            key={url}
            ref={frame}
            title="HTML 运行结果"
            src={url}
            onLoad={() => markHTMLStarted(token)}
            sandbox="allow-scripts"
            allow="autoplay; camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'; display-capture 'none'; local-fonts 'none'"
            referrerPolicy="no-referrer"
          />
          <HTMLResizeHandle height={height} resize={resizeResult} />
        </div>
      )}
      {logs && (
        <details className="html-result-console" open>
          <summary>控制台</summary>
          <pre>{logs}</pre>
        </details>
      )}
    </div>
  );
}
