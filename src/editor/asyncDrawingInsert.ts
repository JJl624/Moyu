import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { canInsertInlineDrawing } from "./drawingInsertion";
import { readNativeSelection } from "./nativeSelection";

interface Job {
  from: number;
  to: number;
  cancelled: boolean;
}
const pending = new WeakMap<EditorView, Set<Job>>();

// File creation is asynchronous. Map its insertion point through edits instead
// of restoring a document snapshot or running viewport restoration afterward.
export function createAsyncDrawingInsertPlugin() {
  const jobs = new Set<Job>();
  return new Plugin({
    state: {
      init: () => null,
      apply(tr) {
        for (const job of jobs) {
          const from = tr.mapping.mapResult(job.from, 1), to = tr.mapping.mapResult(job.to, -1);
          job.cancelled ||= from.deletedAcross || to.deletedAcross;
          job.from = from.pos;
          job.to = Math.max(from.pos, to.pos);
        }
        return null;
      },
    },
    view(view) {
      pending.set(view, jobs);
      return {
        destroy() {
          for (const job of jobs) job.cancelled = true;
          jobs.clear();
          pending.delete(view);
        },
      };
    },
  });
}
export const asyncDrawingInsert = $prose(createAsyncDrawingInsertPlugin);

export function prepareDrawingInsert(view: EditorView) {
  readNativeSelection(view);
  const jobs = pending.get(view);
  if (!jobs || !canInsertInlineDrawing(view.state)) return null;
  const job: Job = {
    from: view.state.selection.from,
    to: view.state.selection.to,
    cancelled: false,
  };
  jobs.add(job);
  const cancel = () => {
    job.cancelled = true;
    jobs.delete(job);
  };
  return {
    cancel,
    insert(raw: string) {
      if (view.isDestroyed || job.cancelled) return false;
      jobs.delete(job);
      job.cancelled = true;
      const selection = TextSelection.create(view.state.doc, job.from, job.to);
      if (!canInsertInlineDrawing({ selection })) return false;
      const node = view.state.schema.nodes.resource_link.create(null, view.state.schema.text(raw));
      const tr = view.state.tr.replaceWith(job.from, job.to, node);
      tr.setSelection(TextSelection.near(tr.doc.resolve(job.from + node.nodeSize)));
      view.dispatch(tr.scrollIntoView());
      view.focus();
      return true;
    },
  };
}
