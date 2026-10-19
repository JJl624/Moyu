// The preview layer owns DOM geometry and the native pointer gesture. It has
// no ProseMirror positions, transactions or document model.
let previewId = 0;
type Entry = {
  source: HTMLElement;
  preview: HTMLElement;
  space: HTMLElement;
  initialEditing: boolean;
  activate: () => void;
};
const layers = new WeakMap<HTMLElement, ReturnType<typeof createLayer>>();
function createLayer(editor: HTMLElement, host: HTMLElement) {
  const entries = new Set<Entry>();
  let queued = false, dragging = false, selecting = false, frame = 0, fallback = 0;
  const style = (element: HTMLElement, name: "maxWidth" | "left" | "top" | "width" | "height", value: number) => {
    const px = value + "px";
    if (element.style[name] !== px) element.style[name] = px;
  };
  let origin: { x: number; y: number } | undefined, clicked: Entry | undefined;
  let dragAnchor: { node: Node; offset: number } | undefined;
  const markSelection = () => {
    const selection = editor.ownerDocument.getSelection();
    if (!selecting) return;
    const range = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0) : null;
    for (const entry of entries) {
      const included = !!range?.intersectsNode(entry.space);
      entry.preview.classList.toggle("drag-selected", included);
    }
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || (event.target as Element).closest("button,input,.cm-editor")) return;
    dragging = true;
    selecting = false;
    clicked = undefined;
    dragAnchor = undefined;
    origin = { x: event.clientX, y: event.clientY };
    for (const entry of entries) {
      entry.initialEditing = entry.preview.hidden;
      entry.preview.classList.remove("drag-selected");
    }
  };
  const move = (event: PointerEvent) => {
    if (!dragging || !(event.buttons & 1) || !origin) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) <= 2) return;
    selecting = true;
    const selection = editor.ownerDocument.getSelection();
    if (!dragAnchor && selection?.anchorNode && editor.contains(selection.anchorNode)) {
      dragAnchor = { node: selection.anchorNode, offset: selection.anchorOffset };
    }
    markSelection();
  };
  const release = (event: Event) => {
    if (!dragging) return;
    const commit = event.type === "pointerup";
    const wasSelecting = selecting, chosen = clicked;
    dragging = false;
    selecting = false;
    clicked = undefined;
    origin = undefined;
    dragAnchor = undefined;
    for (const entry of entries) entry.preview.classList.remove("drag-selected");
    if (commit && !wasSelecting && chosen) chosen.activate();
    else editor.dispatchEvent(new Event("moyu-attachment-selection-settle"));
    editor.dispatchEvent(new Event("moyu-inline-selection"));
  };
  host.addEventListener("pointerdown", down, true);
  host.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  window.addEventListener("blur", release);
  const layout = () => {
    const origin = host.getBoundingClientRect();
    const boxes = [...entries].filter(entry => entry.space.isConnected && !entry.preview.hidden)
      .map(entry => ({
        entry,
        box: entry.space.getBoundingClientRect(),
      }));
    const positions = boxes.map(({ entry, box }) => {
      // An inline preview keeps its own width instead of filling the paragraph.
      const paragraph = entry.source.closest<HTMLElement>("p,h1,h2,h3,h4,h5,h6,td,th");
      return { entry, box, maxWidth: paragraph?.clientWidth || editor.clientWidth };
    });
    for (const { entry, box, maxWidth } of positions) {
      style(entry.preview, "maxWidth", maxWidth);
      style(entry.preview, "left", box.left - origin.left);
      style(entry.preview, "top", box.top - origin.top);
    }
    const heights = boxes.map(({ entry }) => ({
      entry,
      box: entry.preview.getBoundingClientRect(),
    }));
    for (const { entry, box } of heights) {
      style(entry.space, "width", box.width);
      style(entry.space, "height", box.height);
    }
    // Width changes can wrap an inline preview onto the next visual line.
    // Re-read positions synchronously so the overlay never paints at the old line.
    const finalBoxes = boxes.map(({ entry }) => ({ entry, box: entry.space.getBoundingClientRect() }));
    for (const { entry, box } of finalBoxes) {
      style(entry.preview, "left", box.left - origin.left);
      style(entry.preview, "top", box.top - origin.top);
    }
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    // Coalesce geometry work once per frame, with a fallback for occluded windows.
    const flush = () => {
      cancelAnimationFrame(frame);
      clearTimeout(fallback);
      queued = false;
      if (entries.size) layout();
    };
    frame = requestAnimationFrame(flush);
    fallback = window.setTimeout(flush, 32);
  };
  editor.ownerDocument.addEventListener("selectionchange", markSelection);
  const resize = new ResizeObserver(schedule);
  resize.observe(editor);
  resize.observe(host);
  const scope = editor.closest(".document-scroll");
  if (scope) resize.observe(scope);
  window.addEventListener("resize", schedule);
  return {
    schedule,
    choose(entry: Entry) {
      clicked = entry;
      const parent = entry.space.parentNode;
      if (parent) {
        const at = [...parent.childNodes].indexOf(entry.space);
        editor.ownerDocument.getSelection()?.setBaseAndExtent(parent, at, parent, at);
      }
    },
    extend(entry: Entry) {
      if (!selecting || !dragAnchor || !editor.contains(dragAnchor.node)) return;
      const parent = entry.space.parentNode;
      if (!parent) return;
      const at = [...parent.childNodes].indexOf(entry.space);
      const point = editor.ownerDocument.createRange();
      point.setStart(dragAnchor.node, dragAnchor.offset);
      point.collapse(true);
      const backward = point.comparePoint(parent, at) < 0;
      const selection = editor.ownerDocument.getSelection();
      const offset = at + (backward ? 0 : 1);
      if (
        selection?.anchorNode !== dragAnchor.node || selection.anchorOffset !== dragAnchor.offset
        || selection.focusNode !== parent || selection.focusOffset !== offset
      ) {
        selection?.setBaseAndExtent(dragAnchor.node, dragAnchor.offset, parent, offset);
      }
      markSelection();
    },
    get dragging() {
      return dragging;
    },
    add(entry: Entry) {
      entries.add(entry);
      resize.observe(entry.preview);
      resize.observe(entry.space);
      schedule();
    },
    remove(entry: Entry) {
      entries.delete(entry);
      resize.unobserve(entry.preview);
      resize.unobserve(entry.space);
      if (!entries.size) {
        cancelAnimationFrame(frame);
        clearTimeout(fallback);
        resize.disconnect();
        editor.ownerDocument.removeEventListener("selectionchange", markSelection);
        window.removeEventListener("resize", schedule);
        host.removeEventListener("pointerdown", down, true);
        host.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", release);
        window.removeEventListener("blur", release);
        layers.delete(editor);
      }
    },
  };
}
export function createAttachmentPreview(
  source: HTMLElement,
  preview: HTMLElement,
  editor: HTMLElement,
  onActivate: () => void,
) {
  const host = editor.closest<HTMLElement>(".editor-host") || editor.parentElement!,
    space = document.createElement("span");
  space.className = "attachment-space";
  space.contentEditable = "false";
  space.setAttribute("aria-hidden", "true");
  const entry: Entry = { source, preview, space, initialEditing: false, activate: () => onActivate() };
  let external = false, layer: ReturnType<typeof createLayer> | undefined;
  preview.id = "moyu-attachment-preview-" + (++previewId);
  source.dataset.attachmentPreview = preview.id;
  const choose = (event: MouseEvent) => {
    if (external && event.button === 2) {
      event.preventDefault();
      return;
    }
    if (!external || event.button !== 0 || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    layer?.choose(entry);
  };
  preview.addEventListener("mousedown", choose);
  const extend = (event: MouseEvent) => {
    if (!external || !layer?.dragging || !(event.buttons & 1)) return;
    layer.extend(entry);
  };
  preview.addEventListener("mousemove", extend);
  return {
    space,
    get external() {
      return external;
    },
    setEditing(editing: boolean) {
      // The pointer gesture keeps every preview at a stable size. Selection
      // is committed to editable links only after the mouse is released.
      if (external && layer?.dragging) editing = entry.initialEditing;
      const hidden = external && editing;
      const changed = preview.hidden !== hidden || space.hidden !== hidden;
      if (preview.hidden !== hidden) preview.hidden = hidden;
      if (space.hidden !== hidden) space.hidden = hidden;
      if (changed) layer?.schedule();
      return editing;
    },
    schedule() {
      layer?.schedule();
    },
    setVisual(visual: boolean) {
      if (visual === external) {
        return;
      }
      external = visual;
      preview.classList.toggle("attachment-overlay", visual);
      if (visual) {
        source.append(space);
        host.append(preview);
        layer = layers.get(editor) || createLayer(editor, host);
        layers.set(editor, layer);
        layer.add(entry);
      } else {
        layer?.remove(entry);
        layer = undefined;
        space.remove();
        preview.removeAttribute("style");
        source.append(preview);
        preview.hidden = false;
      }
    },
    destroy() {
      layer?.remove(entry);
      delete source.dataset.attachmentPreview;
      preview.removeEventListener("mousedown", choose);
      preview.removeEventListener("mousemove", extend);
      preview.remove();
    },
  };
}
