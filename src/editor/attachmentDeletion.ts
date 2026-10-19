import type { EditorView } from '@milkdown/kit/prose/view';
import type { AttachmentDeletion } from '../editorTypes';
import { inlineLinkAt } from '../inlineSyntax';

// A confirmation must delete precisely the clicked occurrence. If its document
// changes while the dialog is open, require a new confirmation instead of guessing.
export function prepareResourceDeletion(view: EditorView, pos: number, offset: number): AttachmentDeletion | null {
  const doc = view.state.doc, node = doc.nodeAt(pos);
  if (node?.type.name !== 'resource_link') return null;
  const link = inlineLinkAt(node.textContent, offset);
  if (!link) return null;
  const whole = link.from === 0 && link.to === node.content.size;
  const from = whole ? pos : pos + 1 + link.from;
  const to = whole ? pos + node.nodeSize : pos + 1 + link.to;
  let consumed = false;
  const valid = () => !consumed && !view.isDestroyed && view.state.doc === doc;
  return {
    valid,
    remove() {
      if (!valid()) return false;
      consumed = true;
      view.dispatch(view.state.tr.delete(from, to));
      return true;
    },
  };
}

export function prepareAttachmentDeletion(view: EditorView, target: HTMLElement, coords: { left: number; top: number }) {
  const overlay = target.closest<HTMLElement>('.attachment-overlay');
  const source = overlay
    ? [...view.dom.querySelectorAll<HTMLElement>('.inline-syntax')].find(el => el.dataset.attachmentPreview === overlay.id)
    : target.closest<HTMLElement>('.inline-syntax');
  if (!source) return null;
  let result: AttachmentDeletion | null = null;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'resource_link' || view.nodeDOM(pos) !== source) return;
    const link = target.closest<HTMLElement>('[data-link-offset]');
    const offset = link ? Number(link.dataset.linkOffset)
      : overlay ? 0 : Math.max(0, (view.posAtCoords(coords)?.pos ?? pos + 1) - pos - 1);
    result = prepareResourceDeletion(view, pos, offset);
    return false;
  });
  return result;
}
