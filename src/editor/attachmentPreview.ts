// The preview layer owns DOM geometry and the native pointer gesture. It has
// no ProseMirror positions, transactions or document model.
import {touchSettings} from '../touchSettings';
import {attachmentControlTarget} from '../attachments/controlTarget';
import {caretRangeAt} from '../domCaret';
let previewId = 0;
type Entry = {
  source: HTMLElement;
  preview: HTMLElement;
  space: HTMLElement;
  initialEditing: boolean;
  activate: (edit?:boolean) => void;
};
const layers = new WeakMap<HTMLElement, ReturnType<typeof createLayer>>();
function createLayer(editor: HTMLElement, host: HTMLElement) {
  const entries = new Set<Entry>();
  let queued = false, dragging = false, selecting = false, frame = 0, fallback = 0;
  const style = (element: HTMLElement, name: "maxWidth" | "left" | "top" | "width" | "height", value: number) => {
    const px = value + "px";
    if (element.style[name] !== px) element.style[name] = px;
  };
  let origin: { x: number; y: number; touch:boolean; at:number } | undefined, clicked: Entry | undefined;
  let activation: 'select'|'edit'|undefined;
  let dragAnchor: { node: Node; offset: number } | undefined;
  let driven=false;
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
    if (event.button !== 0 || attachmentControlTarget(event.target) || (event.target as Element).closest("button:not(.attachment-preview-caption),input,select,.cm-editor")) return;
    dragging = true;
    selecting = false;
    clicked = undefined;
    activation = undefined;
    dragAnchor = undefined;
    driven=false;
    origin = { x: event.clientX, y: event.clientY, touch:event.pointerType==='touch', at:performance.now() };
    for (const entry of entries) {
      entry.initialEditing = entry.preview.hidden;
      entry.preview.classList.remove("drag-selected");
    }
    const gap=!event.ctrlKey&&!event.metaKey&&!event.shiftKey?paragraphGap(event):undefined;
    if(gap){event.preventDefault();clicked=gap;}
  };
  // Paragraph margins are not editable empty paragraphs. A native click there
  // can resolve to either edge of the hidden reference and unfold the preview.
  // Keep that click inert; a real neighbouring paragraph retains native input.
  const paragraphGap=(event:MouseEvent)=>{
    const target=event.target as Element;
    if(!editor.contains(target)||target.closest('.syntax-preview,.syntax-raw,.cm-editor'))return;
    const point=target.closest('p')?undefined:caretRangeAt(editor.ownerDocument,event.clientX,event.clientY);
    const element=point?.startContainer.nodeType===1?point.startContainer as Element:point?.startContainer.parentElement;
    const paragraph=target.closest('p')||element?.closest('p');
    if(!paragraph)return;
    return [...entries].find(entry=>!entry.preview.hidden&&entry.source.closest('p')===paragraph);
  };
  const gapDown=(event:MouseEvent)=>{
    if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey)return;
    const gap=paragraphGap(event);
    if(gap){event.preventDefault();event.stopPropagation();clicked=gap;}
  };
  const move = (event: PointerEvent) => {
    if (!dragging || !(event.buttons & 1) || !origin) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) <= (origin.touch?touchSettings().touchSlop:2)) return;
    selecting = true;
    if(origin.touch)return; // A touch pan belongs to the native scroller.
    const selection = editor.ownerDocument.getSelection();
    if(!dragAnchor&&clicked?.source.parentNode){
      const parent=clicked.source.parentNode;
      dragAnchor={node:parent,offset:[...parent.childNodes].indexOf(clicked.source)};
    } else if (!dragAnchor && selection?.anchorNode && editor.contains(selection.anchorNode)) {
      dragAnchor = { node: selection.anchorNode, offset: selection.anchorOffset };
    }
    markSelection();
  };
  const extendTo=(node:Node,offset:number)=>{
    if(!dragAnchor||!editor.contains(dragAnchor.node))return;
    const selection=editor.ownerDocument.getSelection();
    if(selection?.anchorNode!==dragAnchor.node||selection.anchorOffset!==dragAnchor.offset||selection.focusNode!==node||selection.focusOffset!==offset)
      selection?.setBaseAndExtent(dragAnchor.node,dragAnchor.offset,node,offset);
    markSelection();
  };
  const extendEntry=(entry:Entry)=>{
    if(!dragAnchor)return;
    const parent=entry.source.parentNode;if(!parent)return;
    const at=[...parent.childNodes].indexOf(entry.source),point=editor.ownerDocument.createRange();
    point.setStart(dragAnchor.node,dragAnchor.offset);point.collapse(true);
    driven=true;extendTo(parent,at+(point.comparePoint(parent,at)<0?0:1));
  };
  // Setting a range across a noneditable overlay ends Chromium's native drag.
  // Continue that same DOM gesture through subsequent overlays and back into
  // text, without asking renderers or the geometry layer for model positions.
  const mouseMove=(event:MouseEvent)=>{
    if(!dragging||!selecting||origin?.touch||!(event.buttons&1)||!dragAnchor)return;
    const entry=[...entries].find(entry=>!entry.preview.hidden&&entry.preview.contains(event.target as Node));
    if(entry){event.preventDefault();extendEntry(entry);return;}
    if(!driven)return;
    const range=caretRangeAt(editor.ownerDocument,event.clientX,event.clientY);
    if(range&&editor.contains(range.startContainer)&&!((range.startContainer.nodeType===1?range.startContainer as Element:range.startContainer.parentElement)?.closest('.attachment-space,.syntax-preview,.cm-editor'))){
      event.preventDefault();extendTo(range.startContainer,range.startOffset);
    }
  };
  const dragStart=(event:DragEvent)=>{
    // Our first range extension must not become a native drag of that newly
    // selected content when the pointer crosses the browser's drag threshold.
    if(dragging&&driven)event.preventDefault();
  };
  const release = (event: Event) => {
    if (!dragging) return;
    const commit = event.type === "pointerup"&&!event.defaultPrevented
      &&(!origin?.touch||performance.now()-origin.at<touchSettings().longPressTimeout);
    const wasSelecting = selecting, chosen = clicked, action = activation;
    dragging = false;
    selecting = false;
    clicked = undefined;
    activation = undefined;
    origin = undefined;
    dragAnchor = undefined;
    driven=false;
    for (const entry of entries) entry.preview.classList.remove("drag-selected");
    if (commit && !wasSelecting && chosen) {
      if(action)chosen.activate(action==='edit');
    } else editor.dispatchEvent(new Event("moyu-attachment-selection-settle"));
    editor.dispatchEvent(new Event("moyu-inline-selection"));
  };
  host.addEventListener("pointerdown", down, true);
  host.addEventListener('mousedown',gapDown,true);
  host.addEventListener("pointermove", move, true);
  host.addEventListener('mousemove',mouseMove,true);
  host.addEventListener('dragstart',dragStart,true);
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
      style(entry.preview, "width", maxWidth);
      style(entry.space, "width", maxWidth);
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
    choose(entry: Entry, action?:'select'|'edit') {
      clicked = entry;
      activation = action;
    },
    extend(entry: Entry) {
      if (!selecting || !dragAnchor || !editor.contains(dragAnchor.node)) return;
      extendEntry(entry);
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
        host.removeEventListener('mousedown',gapDown,true);
        host.removeEventListener("pointermove", move, true);
        host.removeEventListener('mousemove',mouseMove,true);
        host.removeEventListener('dragstart',dragStart,true);
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
  onActivate: (edit?:boolean) => void,
) {
  const host = editor.closest<HTMLElement>(".editor-host") || editor.parentElement!,
    space = document.createElement("span");
  space.className = "attachment-space";
  space.contentEditable = "false";
  space.setAttribute("aria-hidden", "true");
  const entry: Entry = { source, preview, space, initialEditing: false, activate: edit => onActivate(edit) };
  let external = false, layer: ReturnType<typeof createLayer> | undefined;
  preview.id = "moyu-attachment-preview-" + (++previewId);
  source.dataset.attachmentPreview = preview.id;
  const choose = (event: MouseEvent) => {
    if(attachmentControlTarget(event.target))return;
    if (external && event.button === 2) {
      event.preventDefault();
      return;
    }
    if (!external || event.button !== 0 || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    layer?.choose(entry,(event.target as Element).closest('.attachment-preview-caption')?'edit':'select');
  };
  preview.addEventListener("mousedown", choose);
  const touchDown=(event:PointerEvent)=>{
    if(attachmentControlTarget(event.target))return;
    if(!external||event.pointerType!=='touch'||event.button!==0)return;
    // Pointer cancellation still leaves panning to the browser. Suppress the
    // compatibility mouse event, which arrives after touch pointerup.
    event.preventDefault();layer?.choose(entry,(event.target as Element).closest('.attachment-preview-caption')?'edit':'select');
  };
  preview.addEventListener('pointerdown',touchDown);
  const previewKey=(event:KeyboardEvent)=>{
    const caption=(event.target as Element).closest('.attachment-preview-caption');
    if(external&&(caption&&['Enter',' '].includes(event.key)||event.key===' '&&(event.target as Element).closest('.attachment-card'))){
      event.preventDefault();event.stopPropagation();onActivate(!!caption);
    }
  };
  preview.addEventListener('keydown',previewKey);
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
      preview.removeEventListener('pointerdown',touchDown);
      preview.removeEventListener('keydown',previewKey);
      preview.removeEventListener("mousemove", extend);
      preview.remove();
    },
  };
}
