import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { clipboardImages, importClipboardImages } from './clipboardImages';
import { readNativeSelection, focusEditorSelection } from './selectionOwnership';
import { acceptsAttachmentDrop, droppedAttachmentLinks } from './attachmentDrop';
export const imagePaste = (
  document: string,
  root: string | undefined,
  onError: (message: string) => void,
) =>
  $prose(() => {
    const pending = new Set<{ from: number; to: number; cancelled: boolean }>();
    let destroyed = false;
    return new Plugin({
      state: {
        init: () => null,
        apply(tr) {
          for (const job of pending) {
            const from = tr.mapping.mapResult(job.from, 1), to = tr.mapping.mapResult(job.to, -1);
            job.cancelled ||= from.deletedAcross || to.deletedAcross;
            job.from = from.pos;
            job.to = Math.max(from.pos, to.pos);
          }
          return null;
        },
      },
      view: () => ({
        destroy() {
          destroyed = true;
          pending.clear();
        },
      }),
      props: {
        handleDOMEvents: {
          paste(view, event) {
            return insert(view, event);
          },
          drop(view, event) {
            return insert(view, event);
          },
          dragover(view,event){
            if(!view.editable||!acceptsAttachmentDrop(event.dataTransfer))return false;
            const pos=view.posAtCoords({left:event.clientX,top:event.clientY})?.pos;
            if(pos==null||view.state.doc.resolve(pos).parent.type.spec.code)return false;
            event.preventDefault();event.dataTransfer!.dropEffect='copy';return true;
          },
        },
      },
    });
    function insert(
      view: import('@milkdown/kit/prose/view').EditorView,
      event: ClipboardEvent | DragEvent,
    ) {
      if (!view.editable) return false;
      let files: File[];
      try {
        files = event instanceof ClipboardEvent
          ? clipboardImages(event)
          : Array.from(event.dataTransfer?.files || []);
      } catch (error) {
        event.preventDefault();
        onError((error as Error).message);
        return true;
      }
      const drop=event instanceof DragEvent && acceptsAttachmentDrop(event.dataTransfer);
      if (!files.length&&!drop) return false;
      readNativeSelection(view);
      const dropped = event instanceof DragEvent
        ? view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        : null;
      if (event instanceof DragEvent && dropped == null) return false;
      const from = dropped ?? view.state.selection.from, to = dropped ?? view.state.selection.to;
      if (view.state.doc.resolve(from).parent.type.name === 'code_block') return false;
      event.preventDefault();
      const job = { from, to, cancelled: false };
      pending.add(job);
      void (drop?droppedAttachmentLinks((event as DragEvent).dataTransfer!,document,root):importClipboardImages(files, document, root)).then(links => {
        if(!links.length)return;
        if (destroyed || view.isDestroyed || job.cancelled) return;
        pending.delete(job);
        const type = view.state.schema.nodes.resource_link,
          inSource = view.state.doc.resolve(job.from).parent.type.name === 'resource_link',
          nodes = inSource
            ? [view.state.schema.text(links.join('\n'))]
            : links.flatMap((raw,index) => {
              const node=type.create(null,view.state.schema.text(raw));
              return index?[view.state.schema.nodes.hardbreak.create(),node]:[node];
            }),
          selection = view.state.selection;
        const tr = view.state.tr.replaceWith(job.from, job.to, nodes);
        if (dropped != null || selection.from === job.from && selection.to === job.to) {
          const end = job.from + nodes.reduce((size, node) => size + node.nodeSize, 0);
          tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(end, tr.doc.content.size))));
        }
        view.dispatch(tr);
        if (dropped != null) focusEditorSelection(view, 'edit');
      }).catch(error => {
        if (!destroyed) onError((error as Error).message);
      }).finally(() => pending.delete(job));
      return true;
    }
  });
