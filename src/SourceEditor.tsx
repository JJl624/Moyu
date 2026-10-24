import { redo, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, Prec } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { basicSetup, EditorView } from "codemirror";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { documentHeadings } from "../shared/document-outline.mjs";
import { codeBlocks } from "./codeBlocks";
import { exhaustedIdsMessage, normalizeCodeIds } from "./codeIds";
import { chineseEditorPhrases } from "./editor/chinesePhrases";
import { prepareCodeContext } from "./editor/codeContext";
import { inlineWrappers } from './editor/inlineActions';
import { inlineShortcut } from './editor/inlineShortcut';
import { codeIndentation } from "./editor/codeIndentation";
import { sourceImagePaste } from "./editor/sourceImagePaste";
import type { EditorHandle, EditorProps } from "./editorTypes";
import { inlineLinkAt } from "./inlineSyntax";
import { containsDrawingLink } from "./markdownLinks";
import { editorOffset, fileLineBreak, fileOffset, fileText, normalizedText, originalFileText } from "./textFileContent";
function captureSource(view: EditorView): import("./editorTypes").EditorSelection {
  const { anchor, head } = view.state.selection.main,
    point = view.coordsAtPos(head),
    box = view.scrollDOM.getBoundingClientRect(),
    offset = point ? point.top - box.top : undefined;
  return {
    anchor: fileOffset(view.state, anchor),
    head: fileOffset(view.state, head),
    mode: "source",
    caretOffset: offset !== undefined && offset >= 0 && offset < box.height ? offset : undefined,
    source: { anchor: fileOffset(view.state, anchor), head: fileOffset(view.state, head) },
    scrollTop: view.scrollDOM.scrollTop,
    sourceScroll: view.scrollSnapshot(),
    sourceMarkdown: fileText(view.state),
  };
}

export default forwardRef<EditorHandle, EditorProps>(
  function SourceEditor(props, ref) {
    const container = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const edited = useRef(false);
    const navigationEpoch = useRef(0);
    const callbacks = useRef(props);
    const localSelection = useRef<
      { path: string; selection: import("./editorTypes").EditorSelection } | null
    >(null);
    callbacks.current = props;
    useLayoutEffect(() => {
      const restoreEpoch = navigationEpoch.current;
      let metadataChecked = false, exhaustionNotified = false;
      edited.current = false;
      container.current!.dataset.editorPending = "true";
      const selected = localSelection.current?.path === props.path
          ? localSelection.current.selection
          : callbacks.current.selection,
        range = selected?.source || selected;
      const snapshot = selected?.sourceMarkdown === props.value ? selected.sourceScroll : undefined;
      const followCaret = selected?.mode === "rich" && selected.caretOffset !== undefined;
      const initialOffset = (offset: number) =>
        normalizedText(props.value.slice(0, Math.max(0, Math.min(offset, props.value.length)))).length;
      const editor = new EditorView({
        parent: container.current!,
        scrollTo: followCaret
          ? EditorView.scrollIntoView(initialOffset(range!.head), {
            y: "start",
            yMargin: selected!.caretOffset!,
          })
          : snapshot,
        state: EditorState.create({
          doc: props.value,
          selection: range
            ? {
              anchor: initialOffset(range.anchor),
              head: initialOffset(range.head),
            }
            : undefined,
          extensions: [
            basicSetup,
            fileLineBreak.of(props.value.includes("\r\n") ? "\r\n" : "\n"),
            originalFileText(props.value),
            chineseEditorPhrases,
            EditorState.transactionFilter.of(tr => {
              if (!tr.docChanged) return tr;
              let fence = false;
              tr.changes.iterChangedRanges((a, b, c, d) => {
                const old = tr.startState.doc, next = tr.newDoc;
                fence ||= /`{3,}|~{3,}/.test(
                  old.sliceString(old.lineAt(a).from, old.lineAt(b).to)
                    + next.sliceString(next.lineAt(c).from, next.lineAt(d).to),
                );
              });
              if (metadataChecked && !fence) return tr;
              metadataChecked = true;
              const normalized = normalizeCodeIds(props.root, props.path, tr.newDoc.toString());
              if (normalized.exhausted && !exhaustionNotified) {
                exhaustionNotified = true;
                queueMicrotask(() => callbacks.current.onError(exhaustedIdsMessage));
              }
              return normalized.edits.length ? [tr, { changes: normalized.edits, sequential: true }] : tr;
            }),
            codeIndentation(),
            EditorState.readOnly.of(!!props.readOnly),
            EditorView.editable.of(!props.readOnly),
            markdown(),
            sourceImagePaste(props.path, props.root, message => callbacks.current.onError(message)),
            Prec.highest(EditorView.domEventHandlers({
              keydown(event, view) {
                const action=inlineShortcut(event);
                if (!action) return false;
                if(event.isComposing)return true;
                const handled=prepareCodeContext(view,view.contentDOM,undefined,true)?.run(action) || false;
                if (handled) event.preventDefault();
                return handled;
              },
              mousedown(event, view) {
                navigationEpoch.current++;
                if (event.button !== 0 || !event.ctrlKey && !event.metaKey) return false;
                const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }),
                  link = pos === null ? null : inlineLinkAt(view.state.doc.toString(), pos);
                if (!link) return false;
                event.preventDefault();
                window.dispatchEvent(
                  new CustomEvent("moyu-open-link", {
                    detail: { href: link.href, wiki: link.wiki, document: callbacks.current.path },
                  }),
                );
                return true;
              },
            })),
            EditorView.lineWrapping,
            ...(props.theme === "dark" ? [oneDark] : []),
            EditorView.theme({
              "&": {
                fontSize: "var(--size-source, 13px)",
                height: "100%",
                background: "transparent",
              },
              ".cm-scroller": {
                fontFamily: "var(--font-source, var(--font-mono))",
                lineHeight: "var(--line-source, 1.85)",
              },
              ".cm-content": { padding: "26px 24px" },
              ".cm-gutters": {
                background: "transparent",
                border: "none",
                paddingRight: "10px",
                color: "var(--muted)",
              },
            }),
            EditorView.updateListener.of((update) => {
              if(update.docChanged||update.selectionSet)callbacks.current.onContextChange?.();
              if (update.docChanged) {
                edited.current = true;
                callbacks.current.onChange(fileText(update.state));
              }
            }),
          ],
        }),
      });
      view.current = editor;
      callbacks.current.onContextChange?.();
      if (!props.readOnly && props.autoFocus !== false) editor.focus();
      let frame = 0, disposed = false, applied = false, lastGeometry = "";
      const reveal = () => {
        editor.requestMeasure({
          read: () =>
            [
              editor.scrollDOM.scrollTop,
              editor.scrollDOM.scrollHeight,
              editor.coordsAtPos(editor.state.selection.main.head)?.top,
            ].join(":"),
          write: geometry => {
            if (disposed) return;
            if (navigationEpoch.current !== restoreEpoch) {
              delete container.current!.dataset.editorPending;
              return;
            }
            if (!applied && selected && !snapshot && !followCaret) {
              editor.scrollDOM.scrollTop = selected.scrollTop;
              applied = true;
            } else if (geometry === lastGeometry) {
              delete container.current!.dataset.editorPending;
              return;
            }
            lastGeometry = geometry;
            frame = requestAnimationFrame(reveal);
          },
        });
      };
      reveal();
      return () => {
        disposed = true;
        cancelAnimationFrame(frame);
        localSelection.current = { path: props.path, selection: captureSource(editor) };
        editor.destroy();
        view.current = null;
      };
    }, [props.path, props.theme, props.readOnly, props.autoFocus]);
    const insert = (text: string, wrap?: string) => {
      const editor = view.current;
      if (!editor || callbacks.current.readOnly) return;
      const { from, to } = editor.state.selection.main;
      if (
        containsDrawingLink(text)
        && (from !== to
          || codeBlocks(editor.state.doc.toString()).some(b => b.start <= from && b.end >= from))
      ) {
        callbacks.current.onError("请在正文中插入绘图链接。");
        return;
      }
      const selected = editor.state.sliceDoc(from, to);
      const content = wrap !== undefined ? text + selected + wrap : text;
      editor.dispatch({
        changes: { from, to, insert: content },
        selection: { anchor: from + content.length },
      });
      editor.focus();
    };
    useImperativeHandle(ref, () => ({
      selectionContext:()=>view.current?prepareCodeContext(view.current,view.current.contentDOM,undefined,true):null,
      prepareContext: (target, coords) => view.current ? prepareCodeContext(view.current, target, coords) : null,
      prepareAttachmentDelete(target, coords) {
        const v = view.current;
        if (!v || !v.dom.contains(target)) return null;
        const pos = v.posAtCoords({ x: coords.left, y: coords.top });
        const doc = v.state.doc, link = pos === null ? null : inlineLinkAt(doc.toString(), pos);
        if (!link) return null;
        let consumed = false;
        const valid = () => !consumed && view.current === v && v.state.doc === doc;
        return {
          valid,
          remove() {
            if (!valid()) return false;
            consumed = true;
            v.dispatch({ changes: { from: link.from, to: link.to } });
            return true;
          },
        };
      },
      attachmentAt(target, coords) {
        const v = view.current;
        if (!v || !v.dom.contains(target)) return null;
        const pos = v.posAtCoords({ x: coords.left, y: coords.top });
        return pos === null ? null : inlineLinkAt(v.state.doc.toString(), pos);
      },
      canInsertDrawing() {
        const v = view.current;
        if (!v) return false;
        const s = v.state.selection.main;
        return s.empty
          && !codeBlocks(v.state.doc.toString()).some(b => b.start <= s.head && b.end >= s.head);
      },
      visibleOffset() {
        const v = view.current;
        if (!v) return undefined;
        if (
          v.scrollDOM.scrollTop > 0 && v.scrollDOM.scrollHeight - v.scrollDOM.scrollTop - v.scrollDOM.clientHeight < 2
        ) return v.state.doc.length;
        return v.lineBlockAtHeight(Math.max(0, v.scrollDOM.getBoundingClientRect().top - v.documentTop + 24)).from;
      },
      scrollToOffset(offset) {
        navigationEpoch.current++;
        const v = view.current;
        if (!v) return;
        const anchor = editorOffset(v.state, offset);
        v.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
        v.focus();
      },
      scrollToCode(id) {
        navigationEpoch.current++;
        const v = view.current;
        if (!v) return;
        const block = codeBlocks(v.state.doc.toString()).find(b => b.id === id);
        if (block) {
          v.dispatch({
            selection: { anchor: block.start },
            effects: EditorView.scrollIntoView(block.start, { y: "center" }),
          });
          v.focus();
        }
      },
      restoreSelection(selected) {
        const v = view.current;
        if (v) {
          v.dispatch({
            selection: {
              anchor: editorOffset(v.state, selected.anchor),
              head: editorOffset(v.state, selected.head),
            },
          });
        }
      },
      captureSelection() {
        const v = view.current;
        return v ? captureSource(v) : null;
      },
      codeAt: (target) => {
        const v = view.current;
        if (!v) return null;
        let pos = v.state.selection.main.head;
        try {
          pos = v.posAtDOM(target);
        } catch {}
        return codeBlocks(v.state.doc.toString()).find(c => c.start <= pos && c.end >= pos) || null;
      },
      flush: () => {
        if (view.current && edited.current) {
          callbacks.current.onChange(fileText(view.current.state));
        }
      },
      ensureCodeIds() {
        const v = view.current;
        if (!v) return callbacks.current.value;
        const normalized = normalizeCodeIds(props.root, props.path, v.state.doc.toString());
        if (normalized.edits.length) v.dispatch({ changes: normalized.edits });
        return edited.current ? fileText(v.state) : callbacks.current.value;
      },
      replaceCode(target, code, expected) {
        const v = view.current;
        if (!v || callbacks.current.readOnly || !v.dom.contains(target)) return false;
        let pos = v.state.selection.main.head;
        try {
          pos = v.posAtDOM(target);
        } catch {}
        const block = codeBlocks(v.state.doc.toString()).find(b => b.start <= pos && b.end >= pos);
        if (!block || block.code !== expected) return false;
        const raw = v.state.sliceDoc(block.start, block.end),
          lines = raw.split("\n"),
          prefix = lines.at(-1)?.match(/^((?:>\s*)*\s*)[`~]{3,}/)?.[1] || "",
          opening = lines[0],
          closing = lines.at(-1)!;
        if (!/[`~]{3,}/.test(closing)) return false;
        v.dispatch({
          changes: {
            from: block.start,
            to: block.end,
            insert: opening + "\n" + code.split("\n").map(l => prefix + l).join("\n") + "\n"
              + closing,
          },
        });
        return true;
      },
      insert,
      focus: () => view.current?.focus(),
      action(action) {
        if (action === "undo") {
          if (view.current) undo(view.current);
          return;
        }
        if (action === "redo") {
          if (view.current) redo(view.current);
          return;
        }
        const wrappers=inlineWrappers;
        if (wrappers[action]) {
          const v=view.current;
          if(v&&prepareCodeContext(v,v.contentDOM,undefined,true)?.run(action))return;
          insert(wrappers[action][0], wrappers[action][1]);
          return;
        }
        const blocks: Record<string, string> = {
          h1: "# ",
          h2: "## ",
          h3: "### ",
          bullet: "- ",
          ordered: "1. ",
          quote: "> ",
          task: "- [ ] ",
          table: "| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |\n",
          codeblock: "```\n\n```\n",
          divider: "\n---\n",
        };
        insert(blocks[action] ?? "");
      },
      scrollToHeading(index) {
        navigationEpoch.current++;
        const v = view.current;
        if (!v) return;
        const heading = documentHeadings(v.state.doc.toString())[index];
        if (!heading) return;
        v.dispatch({
          selection: { anchor: heading.offset },
          effects: EditorView.scrollIntoView(heading.offset, { y: "start" }),
        });
        if (callbacks.current.autoFocus !== false) v.focus();
      },
    }));
    return (
      <div
        className="source-editor"
        data-editor-pending="true"
        ref={container}
        aria-label="Markdown 源码编辑器"
      />
    );
  },
);
