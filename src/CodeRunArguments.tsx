import { Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { ARGUMENT_VALUES, type ArgumentLanguage } from "../shared/argument-examples.mjs";
import { canonicalLanguage, runtimeKind } from "../shared/code-languages.mjs";
import { pastedArguments, runArguments } from "../shared/runtime-arguments.mjs";
import type { CodeIdentity } from "./codeBlocks";
import { Modal } from "./Modal";
import "./codeRunArguments.css";
export function CodeRunArguments(
  { block, busy, run, close }: { block: CodeIdentity; busy: boolean; run(args: string[]): void; close(): void },
) {
  const [values, setValues] = useState<string[]>([]),
    [draft, setDraft] = useState(""),
    [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null), submitted = useRef(false);
  const examples = ARGUMENT_VALUES[runtimeKind(block.language) as ArgumentLanguage] || ARGUMENT_VALUES.clang;
  const append = (items: string[]) => {
    try {
      const next = runArguments([...values, ...items]);
      setValues(next);
      setDraft("");
      setError("");
      input.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const submit = () => {
    if (busy || submitted.current) return;
    try {
      const args = runArguments([...values, ...(draft !== "" ? [draft] : [])]);
      submitted.current = true;
      run(args);
    } catch (e) {
      submitted.current = false;
      setError((e as Error).message);
    }
  };
  return (
    <Modal title="运行（参数）" onClose={close} initialFocus="textarea[aria-label='新参数']">
      <form
        onContextMenu={event => event.stopPropagation()}
        className="code-run-arguments"
        onSubmit={event => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={event => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            submit();
          }
        }}
      >
        <p className="argument-block">{canonicalLanguage(block.language)}{block.id && <span>{block.id}</span>}</p>
        <div className="argument-list">
          {values.map((value, index) => (
            <div className="argument-row" key={index}>
              <span className="argument-number">{index + 1}</span>
              <textarea
                rows={1}
                aria-label={"参数 " + (index + 1)}
                placeholder="空参数"
                value={value}
                onChange={event => {
                  setValues(previous => previous.map((item, i) => i === index ? event.target.value : item));
                  setError("");
                }}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={"删除参数 " + (index + 1)}
                title="删除参数"
                onClick={() => {
                  setValues(previous => previous.filter((_, i) => i !== index));
                  setError("");
                }}
              >
                <X size={15} />
              </button>
            </div>
          ))}
          <div className="argument-row argument-draft">
            <span className="argument-number">{values.length + 1}</span>
            <textarea
              ref={input}
              rows={1}
              aria-label="新参数"
              placeholder={examples[values.length] || undefined}
              value={draft}
              onChange={event => {
                setDraft(event.target.value);
                setError("");
              }}
              onKeyDown={event => {
                if (
                  event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey
                  && !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  append([draft]);
                }
              }}
              onPaste={event => {
                const text = event.clipboardData.getData("text/plain");
                if (/[\r\n]/.test(text) && draft === "") {
                  event.preventDefault();
                  try {
                    append(pastedArguments(text));
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }
              }}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="添加参数"
              title="添加参数（可留空）"
              disabled={values.length >= 64}
              onClick={() => append([draft])}
            >
              <Plus size={15} />
            </button>
          </div>
        </div>
        <p className="argument-note">每项一个参数，空格和引号按原样传入。仅用于本次运行。</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="argument-footer">
          <button type="button" className="secondary-button" onClick={close}>取消</button>
          <button className="primary-button" type="submit" disabled={busy} title="运行（Ctrl+Enter）">运行</button>
        </div>
      </form>
    </Modal>
  );
}
