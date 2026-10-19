import { useEffect, useState } from "react";
import { api } from "../bridge";
import { Modal } from "../Modal";
import { RuntimeFileTree } from "./RuntimeFileTree";
import { runtimePathTree } from "./runtimeTree";

export function RuntimeAssetSource({ language, official, value, busy, change }: {
  language: string;
  official: string;
  value: string;
  busy: boolean;
  change(value: string): Promise<void>;
}) {
  const [custom, setCustom] = useState(!!value),
    [draft, setDraft] = useState(value),
    [error, setError] = useState(""),
    [files, setFiles] = useState<{ name: string; url: string; bytes: number }[] | null>(null);
  useEffect(() => {
    setCustom(!!value);
    setDraft(value);
  }, [value]);
  const save = async (next: string) => {
    setError("");
    try {
      await change(next);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="runtime-asset-source">
      <label className="runtime-field">
        <span>编译器文件下载源</span>
        <select
          aria-label="编译器文件下载源"
          value={custom ? "custom" : "official"}
          disabled={busy}
          onChange={event => {
            setCustom(event.target.value === "custom");
            if (event.target.value === "official") {
              setDraft("");
              void save("");
            }
          }}
        >
          <option value="official">官方</option>
          <option value="custom">自定义文件服务器</option>
        </select>
      </label>
      {custom
        ? (
          <label className="runtime-field">
            <span>运行文件目录地址</span>
            <input
              type="url"
              aria-label="运行文件目录地址"
              value={draft}
              disabled={busy}
              placeholder={language === "java"
                ? "https://mirror.example.com/teavm/"
                : "https://mirror.example.com/roslyn/dist/"}
              onChange={event => {
                setDraft(event.target.value);
                setError("");
              }}
              onBlur={() => {
                if (draft.trim() !== value) void save(draft.trim());
              }}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
        )
        : <p className="runtime-config-path">{official}</p>}
      <p className="muted-note">
        {language === "java"
          ? "下载 TeaVM 编译器和 Java 标准库。"
          : "下载 .NET WebAssembly 和 Roslyn 编译器。"}自定义服务器需保留相同文件名和目录结构。
        <button
          className="text-button"
          disabled={busy}
          onClick={() =>
            void api.feature<{ name: string; url: string; bytes: number }[]>("runtime.asset-files", {
              language,
            }).then(setFiles).catch(e => setError(e.message))}
        >
          查看文件
        </button>
      </p>
      {error && <p className="feature-error" role="alert">{error}</p>}
      {files && (
        <Modal title="编译器运行文件" wide onClose={() => setFiles(null)}>
          <p className="modal-description">
            服务器地址指向这些文件的共同根目录，程序会自动追加相对路径。文件内容须与配套版本一致；格式化工具通过
            npm 下载源下载。
          </p>
          <div className="manual-resource-inventory">
            <RuntimeFileTree nodes={[{key:language,name:language === 'csharp' ? 'dist/' : 'TeaVM/',kind:'folder',children:runtimePathTree(files)}]} />
          </div>
        </Modal>
      )}
    </div>
  );
}
