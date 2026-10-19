import { useEffect, useRef, useState } from "react";
import { api } from "./bridge";
import {HTMLResult} from './HTMLResult';
import { artifactFileName, validArtifactFileName as valid } from './artifactFileName';
export interface RunArtifact {
  kind: "table" | "image" | "file" | 'html';
  name: string;
  mime?: string;
  data?: string;
  columns?: string[];
  rows?: string[][];
  token?: string;
  pinned?:boolean;
  pinIndex?:number;
  height?:number;
  size?: number;
  rowCount?: number;
  truncated?: boolean;
  textPreview?: boolean;
}
export function artifactBytes(item: RunArtifact): Uint8Array {
  if (item.kind === "table") {
    const cell = (v: string) => "\"" + v.replaceAll("\"", "\"\"") + "\"";
    return new TextEncoder().encode(
      [item.columns || [], ...item.rows || []].map(row => row.map(cell).join(",")).join("\r\n"),
    );
  }
  return Uint8Array.from(atob(item.data || ""), c => c.charCodeAt(0));
}
function Artifact({ item, path }: { item: RunArtifact; path: string }) {
  const container = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(false);
  const [activated,setActivated]=useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      const visible=entries[0]?.isIntersecting || false;setVisible(visible);if(visible)setActivated(true);
    });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const [name, setName] = useState(() => artifactFileName(item.name)),
    [page, setPage] = useState(0),
    [rows, setRows] = useState<string[][]>([]),
    [image, setImage] = useState(""),
    [imageHeight, setImageHeight] = useState(160),
    [text, setText] = useState<{ text: string; truncated: boolean; limit: number } | null>(null),
    [error, setError] = useState("");
  const count = item.rowCount ?? item.rows?.length ?? 0, pages = Math.max(1, Math.ceil(count / 50));
  const size = item.size ?? Math.floor((item.data?.length || 0) * .75);
  useEffect(() => {
    let alive = true;
    if (item.kind === "table" && activated) {
      if (item.token) {
        void api.feature<{ rows: string[][] }>("code.result-page", { token: item.token, page })
          .then(result => {
            if (alive) setRows(result.rows);
          }).catch(e => {
            if (alive) {
              setError(e.message);
            }
          });
      } else setRows((item.rows || []).slice(page * 50, page * 50 + 50));
    }
    return () => {
      alive = false;
    };
  }, [item, page, activated]);
  useEffect(() => {
    let alive = true, url = "";
    if (item.kind === "image" && visible) {
      if (item.token) {
        void api.feature<Uint8Array>("code.result-bytes", { token: item.token, preview: true })
          .then(bytes => {
            if (!alive) return;
            url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: item.mime }));
            setImage(url);
          }).catch(e => {
            if (alive) {
              setError(e.message);
            }
          });
      } else setImage("data:" + item.mime + ";base64," + item.data);
    }
    return () => {
      alive = false;
      if (url) {
        URL.revokeObjectURL(url);
        setImage("");
      }
    };
  }, [item, visible]);
  useEffect(() => {
    let alive = true;
    if (item.kind === "file" && item.textPreview && item.token && visible) {
      void api.feature<{ text: string; truncated: boolean; limit: number } | null>(
        "code.result-text",
        { token: item.token },
      ).then(result => {
        if (alive) setText(result);
      }).catch(e => {
        if (alive) setError(e.message);
      });
    }
    return () => {
      alive = false;
    };
  }, [item, visible]);
  const save = async (attachment = false) => {
    try {
      const bytes = item.token ? undefined : artifactBytes(item);
      if (attachment) {
        const result = await api.feature<{ path: string }>("attachment.upload", {
          document: path,
          name,
          token: item.token,
          bytes,
        });
        window.dispatchEvent(
          new CustomEvent("moyu-result-message", { detail: "已保存到 " + result.path }),
        );
      } else await api.feature("code.export", { name, token: item.token, bytes });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div ref={container} className="run-artifact" data-output-path={item.name}>
      <div className="run-artifact-heading">
        <input
          aria-label="结果文件名"
          title="文件名"
          value={name}
          aria-invalid={!valid(name)}
          onChange={e => setName(e.target.value)}
        />
        <button disabled={!valid(name)} onClick={() => void save()}>保存为文件</button>
        <button disabled={!valid(name)} onClick={() => void save(true)}>保存到附件</button>
      </div>
      {artifactFileName(item.name) !== item.name && <small className="run-artifact-path" aria-label="原始结果路径">
        {item.name}
      </small>}
      {!valid(name) && <small role="alert">请输入有效的文件名。</small>}
      {error && <small role="alert">{error}</small>}
      {item.kind==='html'&&item.token?(activated||!item.pinned?<HTMLResult token={item.token} path={path} pinned={item.pinned} height={item.height}/>:<div style={{height:item.height||360}}/>):item.kind === "table"
        ? (
          <>
            <div className="run-table-scroll">
              <table>
                <thead>
                  <tr>{item.columns?.map((column, i) => <th key={i}>{column}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="run-table-pages">
              <span>{count} 行{item.truncated ? "（达到显示上限）" : ""}</span>
              <button disabled={!page} aria-label="结果上一页" onClick={() => setPage(p => p - 1)}>
                上一页
              </button>
              <span>{page + 1} / {pages}</span>
              <button
                disabled={page + 1 >= pages}
                aria-label="结果下一页"
                onClick={() => setPage(p => p + 1)}
              >
                下一页
              </button>
            </div>
          </>
        )
        : item.kind === "image"
        ? (
          <div className="run-image-preview" style={{ minHeight: error ? 0 : imageHeight }}>
            {image && (
              <img
                alt={name}
                src={image}
                onLoad={e => setImageHeight(e.currentTarget.offsetHeight)}
              />
            )}
          </div>
        )
        : (
          <div className="run-file-preview">
            <small>
              文件 {size < 1024 ? size + ' B' : Math.round(size / 1024 * 10) / 10 + ' KB'}
              {text?.truncated ? "（仅预览前 " + text.limit / 1024 + " KB）" : ""}
            </small>
            {text && (
              <pre
                className="run-text-preview"
                aria-label="文件内容预览"
              >{text.text || '空文件'}</pre>
            )}
          </div>
        )}
    </div>
  );
}
export function RunArtifacts({ items, path }: { items: RunArtifact[]; path: string }) {
  return (
    <div className="run-artifacts">
      {items.map((item, index) => <Artifact key={item.token || index} item={item} path={path} />)}
    </div>
  );
}
