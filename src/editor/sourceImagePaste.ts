import { EditorView, ViewPlugin } from '@codemirror/view';
import { codeBlocks } from '../codeBlocks';
import { clipboardImages, importClipboardImages } from './clipboardImages';

// CodeMirror and ProseMirror share the file import pipeline. This adapter only
// owns source-editor insertion bookmarks and their lifetime.
export function sourceImagePaste(
  document: string,
  root: string | undefined,
  onError: (message: string) => void,
) {
  return ViewPlugin.fromClass(
    class {
      pending = new Set<{ from: number; to: number; cancelled: boolean }>();
      destroyed = false;
      update(update: import('@codemirror/view').ViewUpdate) {
        if (!update.docChanged) return;
        for (const job of this.pending) {
          update.changes.iterChangedRanges((from, to) => {
            if (
              from < to && (job.from === job.to
                ? from < job.from && to > job.to
                : from < job.to && to > job.from)
            ) job.cancelled = true;
          });
          const from = update.changes.mapPos(job.from, 1), to = update.changes.mapPos(job.to, -1);
          job.from = from;
          job.to = Math.max(from, to);
        }
      }
      insert(event: ClipboardEvent | DragEvent, view: EditorView) {
        if (view.state.readOnly || !view.state.facet(EditorView.editable)) return false;
        let files: File[];
        try {
          files = event instanceof ClipboardEvent
            ? clipboardImages(event)
            : Array.from(event.dataTransfer?.files || []).filter(file =>
              /^image\//i.test(file.type)
            );
        } catch (error) {
          event.preventDefault();
          onError((error as Error).message);
          return true;
        }
        if (!files.length) return false;
        const dropped = event instanceof DragEvent
          ? view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
          : null;
        if (event instanceof DragEvent && dropped === null) return false;
        const selection = view.state.selection.main,
          from = dropped ?? selection.from,
          to = dropped ?? selection.to;
        if (
          codeBlocks(view.state.doc.toString()).some(block =>
            block.start <= from && block.end >= from
          )
        ) return false;
        event.preventDefault();
        const job = { from, to, cancelled: false };
        this.pending.add(job);
        void importClipboardImages(files, document, root).then(links => {
          if (this.destroyed || job.cancelled) return;
          this.pending.delete(job);
          const text = links.join('\n'), current = view.state.selection.main;
          view.dispatch({
            changes: { from: job.from, to: job.to, insert: text },
            ...(dropped !== null || current.from === job.from && current.to === job.to
              ? { selection: { anchor: job.from + text.length } }
              : {}),
          });
          if (dropped !== null) view.focus();
        }).catch(error => {
          if (!this.destroyed) onError((error as Error).message);
        }).finally(() => this.pending.delete(job));
        return true;
      }
      destroy() {
        this.destroyed = true;
        this.pending.clear();
      }
    },
    {
      eventHandlers: {
        paste(event, view) {
          return this.insert(event, view);
        },
        drop(event, view) {
          return this.insert(event, view);
        },
      },
    },
  );
}
