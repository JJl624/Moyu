import { useEffect, useState } from "react";
const sources = [["https://registry.npmjs.org/", "npm 官方"], [
  "https://registry.npmmirror.com/",
  "npmmirror",
]];
export function DownloadSource(
  { value, disabled, onChange, label = "npm 下载源" }: {
    value: string;
    label?: string;
    disabled: boolean;
    onChange(value: string): Promise<void>;
  },
) {
  const [custom, setCustom] = useState(false), [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
    setCustom(!sources.some(([url]) => url === value.replace(/\/*$/, "/")));
  }, [value]);
  const commit = async () => {
    if (draft.trim() && draft.trim() !== value) await onChange(draft.trim());
  };
  return (
    <div className="download-source">
      <div className="pref-row">
        <span>{label}</span>
        <select
          aria-label="下载源"
          disabled={disabled}
          value={custom ? "custom" : value.replace(/\/*$/, "/")}
          onChange={e => {
            if (e.target.value === "custom") {
              setCustom(true);
              return;
            }
            setCustom(false);
            void onChange(e.target.value);
          }}
        >
          {sources.map(([url, label]) => <option value={url} key={url}>{label}</option>)}
          <option value="custom">自定义镜像</option>
        </select>
      </div>
      {custom && (
        <input
          aria-label="镜像地址"
          type="url"
          disabled={disabled}
          placeholder="https://npm.example.com/"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={e => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      )}
    </div>
  );
}
