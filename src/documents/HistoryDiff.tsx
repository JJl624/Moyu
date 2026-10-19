import { searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView, keymap, lineNumbers } from "@codemirror/view";
import { useLayoutEffect, useMemo, useRef } from "react";
import { compareText } from "../../shared/content-diff.mjs";
import { diffAnchors, mapDiffOffset } from "../../shared/diff-anchors.mjs";
import { chineseEditorPhrases } from "../editor/chinesePhrases";
export function HistoryDiff(
  { left, right, labels = ["历史版本", "当前内容"], contentLabels = ["历史版本内容", "当前文档内容"] }: {
    left: string;
    right: string;
    labels?: [string, string];
    contentLabels?: [string, string];
  },
) {
  const host = useRef<HTMLDivElement>(null),
    diff = useMemo(() => compareText(left.replace(/\r\n?/g, "\n"), right.replace(/\r\n?/g, "\n")), [left, right]);
  useLayoutEffect(() => {
    if (!host.current) return;
    const views = (["left", "right"] as const).map(side => {
      let offset = 0;
      const ranges = diff[side].flatMap(part => {
        const from = offset;
        offset += part.value.length;
        return part.changed && offset > from
          ? [
            Decoration.mark({ tagName: "mark", class: "history-change-" + side + " diff-" + side }).range(from, offset),
          ]
          : [];
      });
      return new EditorView({
        parent: host.current!.querySelector<HTMLElement>("[data-side=" + side + "]")!,
        state: EditorState.create({
          doc: (side === "left" ? left : right).replace(/\r\n?/g, "\n"),
          extensions: [
            lineNumbers(),
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            EditorView.lineWrapping,
            chineseEditorPhrases,
            keymap.of(searchKeymap),
            keymap.of(["Mod-z", "Mod-y", "Mod-Shift-z"].map(key => ({ key, run: () => true }))),
            EditorView.decorations.of(Decoration.set(ranges)),
            EditorView.contentAttributes.of({ "aria-label": contentLabels[side === "left" ? 0 : 1], tabindex: "0" }),
          ],
        }),
      });
    });
    const anchors = diffAnchors(diff);
    let frame = 0, release = 0, syncing: EditorView | null = null;
    const listeners = views.map((view, index) => {
      const other = views[1 - index], source = index ? "b" : "a";
      const listener = () => {
        if (syncing === view) return;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const top = Math.max(0, view.scrollDOM.getBoundingClientRect().top - view.documentTop);
          const line = view.lineBlockAtHeight(top), offset = line.from;
          const mapped = mapDiffOffset(anchors, offset, source)
            ?? Math.round(offset / Math.max(1, view.state.doc.length) * other.state.doc.length);
          syncing = other;
          other.scrollDOM.scrollTop = other.lineBlockAt(Math.min(mapped, other.state.doc.length)).top + top - line.top;
          cancelAnimationFrame(release);
          release = requestAnimationFrame(() => {
            syncing = null;
          });
        });
      };
      view.scrollDOM.addEventListener("scroll", listener);
      let first = 0;
      for (const part of diff[index ? "right" : "left"]) {
        if (part.changed) {
          view.dispatch({ effects: EditorView.scrollIntoView(first, { y: "center" }) });
          break;
        }
        first += part.value.length;
      }
      return listener;
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(release);
      views.forEach((view, i) => {
        view.scrollDOM.removeEventListener("scroll", listeners[i]);
        view.destroy();
      });
    };
  }, [diff, left, right, contentLabels[0], contentLabels[1]]);
  return (
    <div className="history-diff-editors" ref={host}>
      <section>
        <header>
          <span>{labels[0]}</span>
          <small className="history-deleted">删除</small>
        </header>
        <div data-side="left" />
      </section>
      <section>
        <header>
          <span>{labels[1]}</span>
          <small className="history-added">新增</small>
        </header>
        <div data-side="right" />
      </section>
    </div>
  );
}
