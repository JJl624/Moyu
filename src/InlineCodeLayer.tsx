import { Play, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { codeId } from "../shared/code-documents.mjs";
import { api } from "./bridge";
import { type CodeIdentity, codeKey, runnable } from "./codeBlocks";
import { CodeRunArguments } from "./CodeRunArguments";
import type { EditorHandle } from "./editorTypes";
import { RunArtifacts } from "./RunArtifacts";
import type { CodeRuns } from "./useCodeRuns";
import { runtimeKind } from '../shared/code-languages.mjs';
interface Target {
  dom: HTMLElement;
  header: HTMLElement;
  output: HTMLElement;
  block: CodeIdentity & { start?: number };
  key: string;
}
export function InlineCodeLayer(
  { path, mode, editor, runs }: {
    path: string;
    mode: string;
    editor: React.RefObject<EditorHandle | null>;
    runs: CodeRuns;
  },
) {
  const [argumentBlock, setArgumentBlock] = useState<CodeIdentity | null>(null);
  const [targets, setTargets] = useState<Target[]>([]), current = useRef(runs);
  current.current = runs;
  useEffect(() => {
    const scope = document.querySelector(".document-scroll");
    if (!scope) return;
    let frame = 0, stopped = false;
    const measured = new Set<HTMLElement>();
    // Observe only headers whose actual size changes. Measuring every header
    // during cursor/gutter mutations forces layout across a long document.
    const sizes = new ResizeObserver(entries => {
      for (const entry of entries) {
        const dom = entry.target.closest<HTMLElement>(".milkdown-code-block,.code-block-shell");
        if (!dom) continue;
        const width = Math.ceil(entry.contentRect.width) || 54;
        if (dom.style.getPropertyValue("--moyu-run-action-width") !== width + "px") {
          dom.style.setProperty("--moyu-run-action-width", width + "px");
        }
      }
    });
    const prepared = new Set<string>();
    const scan = () => {
      frame = 0;
      if (stopped) return;
      const next: Target[] = [], counts = new Map<string, number>(), languages = new Set<string>();
      const blocks = scope.querySelectorAll<HTMLElement>(
        ".milkdown-code-block,.reading-view .code-block-shell",
      );
      for (const dom of blocks) {
        const code = mode === "read"
          ? {
            language: dom.dataset.language || "",
            meta: dom.dataset.codeMeta || "",
            id: codeId(dom.dataset.codeMeta || ""),
            code: dom.querySelector("pre > code")?.textContent?.replace(/\n$/, "") || "",
          }
          : editor.current?.codeAt?.(dom);
        if (!code || !runnable(code.language)) {
          dom.querySelector(".code-inline-actions")?.remove();
          dom.querySelector(":scope > .code-ui")?.remove();
          delete dom.dataset.runnable;
          continue;
        }
        const clean = code.code;
        const signature = JSON.stringify([code.language.toLowerCase(), clean]),
          occurrence = counts.get(signature) ?? 0;
        counts.set(signature, occurrence + 1);
        const block = { ...code, code: clean, occurrence }, key = codeKey(block);
        const kind = runtimeKind(code.language)!;
        languages.add(kind);
        if (api.desktop && !["clang", "csharp", "java", "ruby", "bash"].includes(kind) && !prepared.has(kind)) {
          prepared.add(kind);
          void api.feature("code.prepare", { language: kind, code: clean }).catch(() => {});
        }
        let header: HTMLElement, output: HTMLElement;
        {
          let host = dom.querySelector<HTMLElement>(":scope > .code-ui");
          if (!host) {
            host = document.createElement("div");
            host.className = "code-ui";
            host.contentEditable = "false";
            host.innerHTML = "<div class=\"code-inline-actions\"></div><div class=\"code-inline-output\"></div>";
            dom.appendChild(host);
          }
          header = dom.querySelector<HTMLElement>(".code-inline-actions")!;
          if (!header) {
            header = document.createElement("div");
            header.className = "code-inline-actions";
            host.prepend(header);
          }
          output = host.querySelector<HTMLElement>(".code-inline-output")!;
          // Keep React's portal outside Milkdown's Vue-owned controls. Vue can
          // replace that group after a language/preview change and erase it.
          if (header.parentElement !== host) host.prepend(header);
        }
        dom.dataset.runnable = "true";
        next.push({ dom, header, output, block, key });
      }
      const headers = new Set(next.map(t => t.header));
      for (const header of measured) {
        if (!headers.has(header)) {
          sizes.unobserve(header);
          measured.delete(header);
        }
      }
      for (const header of headers) {
        if (!measured.has(header)) {
          sizes.observe(header);
          measured.add(header);
        }
      }
      for (const language of prepared) if (!languages.has(language)) prepared.delete(language);
      setTargets(old =>
        old.length === next.length
          && old.every((t, i) =>
            t.header === next[i].header && t.output === next[i].output && t.key === next[i].key
            && t.block.id === next[i].block.id
            && t.block.start === next[i].block.start && t.block.meta === next[i].block.meta
          )
          ? old
          : next
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(scan);
    };
    const observer = new MutationObserver(changes => {
      if (
        changes.some(c => {
          const element = c.target instanceof Element ? c.target : c.target.parentElement;
          if (element?.closest(".code-ui,.cm-gutters,.cm-cursorLayer,.cm-selectionLayer,.cm-tooltip,.code-run-arguments,.modal-overlay")) return false;
          if (element?.closest('.milkdown-code-block,.code-block-shell')) return true;
          return c.type === 'childList' && [...c.addedNodes, ...c.removedNodes].some(node =>
            node instanceof Element && (node.matches('.milkdown-code-block,.code-block-shell')
              || !!node.querySelector('.milkdown-code-block,.code-block-shell'))
          );
        })
      ) schedule();
    });
    observer.observe(scope, { childList: true, subtree: true, characterData: true });
    scan();
    const run = (e: Event) => {
      const detail = (e as CustomEvent).detail, dom = detail.target as HTMLElement;
      const target = targetsRef.current.find(t => t.dom === dom || t.dom.contains(dom))
        || targetsRef.current.find(t =>
          detail.start !== undefined
            ? t.block.start === detail.start
            : t.block.code === detail.code && t.block.language === detail.language
        );
      if (target) {
        if (e.type === "moyu-run-code-arguments") setArgumentBlock({ ...target.block });
        else void current.current.run(target.block);
      }
    };
    window.addEventListener("moyu-run-code", run);
    window.addEventListener("moyu-run-code-arguments", run);
    window.addEventListener("moyu-code-dom", schedule);
    const keepWarm = () => {
      if (stopped || document.visibilityState !== "visible" || !document.hasFocus()) return;
      for (const language of prepared) {
        if (language === "javascript") {
          void api.feature("code.prepare", { language }).catch(() => {});
        }
      }
    };
    const lease = setInterval(keepWarm, 25000);
    window.addEventListener("focus", keepWarm);
    return () => {
      stopped = true;
      clearInterval(lease);
      window.removeEventListener("focus", keepWarm);
      cancelAnimationFrame(frame);
      observer.disconnect();
      sizes.disconnect();
      measured.clear();
      window.removeEventListener("moyu-run-code", run);
      window.removeEventListener("moyu-run-code-arguments", run);
      window.removeEventListener("moyu-code-dom", schedule);
    };
  }, [path, mode, editor]);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  return (
    <>
      {argumentBlock && (
        <CodeRunArguments
          block={argumentBlock}
          busy={runs.busy}
          close={() => setArgumentBlock(null)}
          run={args => {
            const target = targetsRef.current.find(t => codeKey(t.block) === codeKey(argumentBlock));
            if (!target) throw Error("代码块已更改，请重新打开运行窗口。");
            setArgumentBlock(null);
            void current.current.run(target.block, args);
          }}
        />
      )}
      {targets.map((t, index) => {
        const result = runs.values[t.key];
        const halt = (e: React.MouseEvent) => e.stopPropagation();
        return (
          <span key={t.key + index}>
            {createPortal(
              <div
                className="code-actions"
                onMouseDown={e => {
                  if (!(e.target as Element).closest("select")) e.preventDefault();
                }}
                onClick={halt}
              >
                {/^(js|javascript|ts|typescript)$/i.test(t.block.language) && (
                  <select
                    aria-label="JavaScript 运行模式"
                    value={runs.modeFor(t.block.id || t.key)}
                    onMouseDown={e => e.stopPropagation()}
                    onChange={e => runs.setMode(t.block.id || t.key, e.target.value as "worker" | "dom")}
                  >
                    <option value="worker">JavaScript</option>
                    <option value="dom">DOM / HTML</option>
                  </select>
                )}
                {/^(sql|sqlite)$/i.test(t.block.language) && (
                  <select
                    aria-label="数据库范围"
                    value={runs.scopeFor(t.block.id || t.key)}
                    onMouseDown={e => e.stopPropagation()}
                    onChange={e => runs.setScope(t.block.id || t.key, e.target.value as "global" | "block" | "memory")}
                  >
                    <option value="block">块级</option>
                    <option value="global">全局</option>
                    <option value="memory">内存</option>
                  </select>
                )}
                {/^(bash|sh|shell)$/i.test(t.block.language) && (
                  <select
                    aria-label="Bash 数据范围"
                    value={runs.scopeFor(t.block.id || t.key) === "memory" ? "memory" : "block"}
                    onMouseDown={e => e.stopPropagation()}
                    onChange={e => runs.setScope(t.block.id || t.key, e.target.value as "block" | "memory")}
                  >
                    <option value="block">块</option>
                    <option value="memory">内存</option>
                  </select>
                )}
                {result?.running
                  ? (
                    <button
                      aria-label="停止运行"
                      onClick={() => void runs.stop()}
                    >
                      <Square size={13} />停止
                    </button>
                  )
                  : (
                    <button
                      aria-label="运行代码块"
                      disabled={runs.busy}
                      onClick={() => void runs.run(t.block)}
                    >
                      <Play size={13} />运行
                    </button>
                  )}
              </div>,
              t.header,
            )}
            {createPortal(
              result
                ? (
                  <section
                    className="code-result"
                    aria-label="代码运行结果"
                    onClick={halt}
                    contentEditable={false}
                  >
                    <header>
                      <span title="关闭文档后清除">运行结果</span>
                      <small
                        title={result.executionMs !== undefined
                          ? `执行 ${Math.round(result.executionMs)} ms，环境准备 ${
                            Math.round(result.startupMs || 0)
                          } ms`
                          : undefined}
                      >
                        {result.running
                          ? "正在准备并运行…"
                          : `${result.artifacts?.some(a => a.kind === "html") ? "准备耗时" : "总耗时"} ${
                            Math.round(result.elapsed)
                          } ms`}
                      </small>
                      <button aria-label="关闭运行结果" onClick={() => runs.close(t.key)}>
                        <X size={14} />
                      </button>
                    </header>
                    {(result.running || result.output || result.error || !result.artifacts?.length)
                      && (
                        <pre
                          className="code-output"
                          aria-live="polite"
                        >{result.output}{result.error&&<span className="error-text">{(result.output?'\n':'')+result.error}</span>}{!result.running&&!result.output&&!result.error?'无输出':''}</pre>
                      )}
                    {!!result.artifacts?.length && <RunArtifacts items={result.artifacts} path={path} />}
                  </section>
                )
                : null,
              t.output,
            )}
          </span>
        );
      })}
    </>
  );
}
