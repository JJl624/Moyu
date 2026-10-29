import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { readNativeSelection,focusEditorSelection } from "./selectionOwnership";
import {touchSettings} from '../touchSettings';
import {attachmentControlTarget} from '../attachments/controlTarget';

// Floating controls must never take the pointer away from a native text drag.
export const selectionGesture = $prose(() =>
  new Plugin({
    view(view) {
      const host = view.dom.closest<HTMLElement>(".editor-host") || view.dom;
      let origin: { x: number; y: number; touch:boolean; at:number } | undefined;
      const down = (event: PointerEvent) => {
        const target = event.target as Element;
        if (
          event.button === 0 && !attachmentControlTarget(target) && !target.closest("button,input,select,.cm-editor,[role=separator],.tools,.html-note-tools,.code-language-menu")
          && (view.dom.contains(target) || target.closest(".attachment-overlay"))
        ) {
          origin = { x: event.clientX, y: event.clientY,touch:event.pointerType==='touch',at:performance.now() };
        }
      };
      const move = (event: PointerEvent) => {
        if (origin && event.buttons & 1 && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > (origin.touch?touchSettings().touchSlop:2)) {
          if (host.dataset.pointerSelecting !== "true") host.dataset.pointerSelecting = "true";
        }
      };
      const release = (event?: Event) => {
        const target = event?.target as Element | null;
        if (
          origin && event?.type === "pointerup" && !event.defaultPrevented && target?.closest?.("p,h1,h2,h3,h4,h5,h6") && view.dom.contains(target)
          && !target.closest("td,th,.cm-editor,.inline-syntax")
        ) {
          const native = view.dom.ownerDocument.getSelection(), focus = native?.focusNode;
          const focusElement = focus instanceof Element ? focus : focus?.parentElement;
          if (host.dataset.pointerSelecting !== "true" && focusElement?.closest(".cm-editor")) {
            const pointer = event as PointerEvent,
              point = view.posAtCoords({ left: pointer.clientX, top: pointer.clientY });
            if (point) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(point.pos))));
          } else readNativeSelection(view);
          // Finish a plain-text click in the outer editor before a stale inner
          // CodeMirror focus update can restore its previous selection.
          if (
            view.state.selection.empty
            && !(origin.touch&&host.closest('.mobile-app')&&performance.now()-origin.at>=touchSettings().longPressTimeout)
            && !["code_block", "math_block"].includes(view.state.selection.$head.parent.type.name)
          ) focusEditorSelection(view, 'edit');
        }
        origin = undefined;
        delete host.dataset.pointerSelecting;
      };
      host.addEventListener("pointerdown", down, true);
      host.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", release);
      window.addEventListener("blur", release);
      return {
        destroy() {
          release();
          host.removeEventListener("pointerdown", down, true);
          host.removeEventListener("pointermove", move, true);
          window.removeEventListener("pointerup", release);
          window.removeEventListener("pointercancel", release);
          window.removeEventListener("blur", release);
        },
      };
    },
  })
);
