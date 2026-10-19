import { isComposingKey } from '../keyboardComposition';
import "./fileNameInput.css";
import { Check, FilePlus2, FolderPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function FileNameInput({ folder = false, document = false, create, cancel }: {
  folder?: boolean;
  document?: boolean;
  create(name: string): Promise<void>;
  cancel(): void;
}) {
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null), submitting = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.scrollIntoView({ block: "nearest" });
  }, []);
  useEffect(() => {
    if (error && !busy) input.current?.focus();
  }, [error, busy]);
  const submit = async () => {
    if (submitting.current) return;
    const value = name.trim();
    if (
      !value || /^[.]/.test(value) || /[\\/<>:"|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(value)
    ) {
      setError("请输入有效的文件名称");
      input.current?.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await create(value);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <form
      className="file-name-form"
      onSubmit={event => {
        event.preventDefault();
        event.stopPropagation();
        void submit();
      }}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key === "Escape" && !isComposingKey(event) && !submitting.current) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <div className="file-name-entry">
        {folder ? <FolderPlus size={15} /> : <FilePlus2 size={15} />}
        <input
          ref={input}
          aria-label={folder ? "新文件夹名称" : "新文件名称"}
          value={name}
          disabled={busy}
          placeholder={folder ? "文件夹名" : document ? "文档名.md" : "例如：input.txt"}
          onChange={event => {
            setName(event.target.value);
            setError("");
          }}
        />
        <button
          className="icon-button"
          type="submit"
          disabled={busy || !name.trim()}
          aria-label="创建"
          title="创建"
        >
          <Check size={14} />
        </button>
        <button
          className="icon-button"
          type="button"
          disabled={busy}
          onClick={cancel}
          aria-label="取消新建"
          title="取消"
        >
          <X size={14} />
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}
