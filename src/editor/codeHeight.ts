import { isComposingKey } from '../keyboardComposition';
import {bindCodeResize} from '../codeResizeGesture';
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { codeId, codeInfo } from "../../shared/code-documents.mjs";
import { applyMermaidSize } from "../Mermaid";
import { attributeGroups, heightFromMeta, withAttributeGroups, withHeight } from "./codeMetadata";
export { heightFromMeta, withHeight } from "./codeMetadata";
const layouts = new WeakMap<HTMLElement, HTMLElement>();
export function codeScrollContainer(
  code: { dom: HTMLElement; scrollDOM: HTMLElement },
): HTMLElement {
  return code.dom.closest<HTMLElement>(".tabs-editor") || code.scrollDOM;
}
export function codeLayoutsReady(view: EditorView) {
  let ready = true;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== "code_block") return;
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) {
      ready = false;
      return;
    }
    const target = dom.querySelector<HTMLElement>(".cm-editor");
    if (!target || layouts.get(dom) !== target) ready = false;
  });
  return ready;
}
export const codeAttributes = codeBlockSchema.extendSchema(previous => ctx => {
  const schema = previous(ctx);
  return {
    ...schema,
    attrs: { ...schema.attrs, meta: { default: "", validate: "string" } },
    parseMarkdown: {
      ...schema.parseMarkdown,
      runner(state, node, type) {
        const info = codeInfo({ lang: node.lang, meta: node.meta });
        state.openNode(type, { language: info.language || "text", meta: info.meta });
        if (node.value) state.addText(String(node.value));
        state.closeNode();
      },
    },
    toMarkdown: {
      ...schema.toMarkdown,
      runner(state, node) {
        state.addNode("code", undefined, node.textContent, {
          lang: node.attrs.language || "text",
          meta: node.attrs.meta || null,
        });
      },
    },
  };
});
export const resizeCodeBlocks = $prose(() =>
  new Plugin({
    view(view) {
      let queued = false, destroyed = false;
      const dragging = new Set<HTMLElement>();
      const cleanups = new Map<
        HTMLElement,
        { cm: HTMLElement; handle: HTMLElement; field: HTMLInputElement; cleanup: () => void }
      >();
      const scan = () => {
        queued = false;
        // React detaches the host before Milkdown finishes its asynchronous
        // disposal. Rebuilding controls there can feed this observer forever.
        if (destroyed || view.isDestroyed || !view.dom.isConnected) return;
        const alive = new Set<HTMLElement>();
        view.state.doc.descendants((node, pos) => {
          if (node.type.name !== "code_block") {
            return;
          }
          const dom = view.nodeDOM(pos);
          if (!(dom instanceof HTMLElement)) return;
          const cm = dom.querySelector<HTMLElement>(".cm-editor");
          if (!cm) return;
          const heightTarget = dom.querySelector<HTMLElement>(".tabs-frame") || cm;
          alive.add(dom);
          const height = heightFromMeta(node.attrs.meta || ""),
            cssHeight = height ? height + "px" : "";
          if (!dragging.has(dom) && heightTarget.style.height !== cssHeight) {
            heightTarget.style.height = cssHeight;
          }
          dom.dataset.codeHeight = height ? String(height) : "";
          for (const diagram of dom.querySelectorAll<HTMLElement>(".mermaid-diagram")) {
            diagram.dataset.mermaidMeta = node.attrs.meta || "";
            const svg = diagram.querySelector("svg");
            if (svg) applyMermaidSize(svg, node.attrs.meta || "");
          }
          const previous = cleanups.get(dom);
          if (previous?.cm === cm && dom.contains(previous.handle) && dom.contains(previous.field)) {
            const badge = dom.querySelector<HTMLElement>(".code-id");
            const id = codeId(node.attrs.meta || "");
            if (badge && badge.textContent !== id) badge.textContent = id;
            if (document.activeElement !== previous.field) {
              previous.field.value = attributeGroups(node.attrs.meta || "");
            }
            layouts.set(dom, cm);
            return;
          }
          previous?.cleanup();
          const attributes = document.createElement("div");
          attributes.className = "code-attributes";
          attributes.contentEditable = "false";
          const field = document.createElement("input");
          field.type = "text";
          field.className = "code-attributes-input";
          field.setAttribute("aria-label", "代码块自定义属性");
          field.spellcheck = false;
          field.maxLength = 4096;
          field.value = attributeGroups(node.attrs.meta || "");
          field.title = "编辑围栏中的 {} 属性，例如 {height=160 size=50%}";
          attributes.append(field);
          const tools = dom.querySelector(".tools"),
            language = tools?.querySelector(".language-button");
          if (language) language.after(attributes);
          else if (tools) tools.prepend(attributes);
          else cm.parentElement?.before(attributes);
          const badge = document.createElement("span");
          badge.className = "code-id";
          badge.contentEditable = "false";
          badge.textContent = codeId(node.attrs.meta || "");
          badge.title = "代码块 ID";
          badge.setAttribute("aria-label", "代码块 ID");
          attributes.before(badge);
          const handle = document.createElement("div");
          handle.className = "code-resize";
          handle.contentEditable = "false";
          handle.setAttribute("role", "separator");
          handle.setAttribute("aria-label", "拖动调整代码块高度");
          handle.title = "拖动调整高度；双击恢复不限高度";
          heightTarget.after(handle);
          const position = () => {
            let found: number | undefined;
            view.state.doc.descendants((n, p) => {
              if (n.type.name === "code_block" && view.nodeDOM(p) === dom) found = p;
            });
            return found;
          };
          const save = (height: number | null) => {
            const at = position();
            if (at === undefined) return;
            const n = view.state.doc.nodeAt(at)!,
              meta = n.attrs.meta || "",
              next = withHeight(meta, height);
            field.value = attributeGroups(next);
            field.setAttribute("aria-invalid", "false");
            if (next !== meta) view.dispatch(view.state.tr.setNodeAttribute(at, "meta", next));
          };
          const apply = () => {
            const at = position();
            if (at === undefined) return false;
            const meta = view.state.doc.nodeAt(at)!.attrs.meta || "",
              next = withAttributeGroups(meta, field.value);
            field.setAttribute("aria-invalid", String(next === null));
            if (next === null) return false;
            if (next !== meta) view.dispatch(view.state.tr.setNodeAttribute(at, "meta", next));
            return true;
          };
          const input = () => {
            if (!field.matches(":read-only")) apply();
          };
          const blur = () => {
            const at = position();
            field.value = attributeGroups(
              at === undefined ? "" : view.state.doc.nodeAt(at)?.attrs.meta || "",
            );
            field.setAttribute("aria-invalid", "false");
          };
          const keys = (event: KeyboardEvent) => {
            if (isComposingKey(event)) return;
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              if (apply()) {
                cm.querySelector<HTMLElement>(".cm-content")?.focus({ preventScroll: true });
              }
            } else if (event.key === "Escape") {
              event.preventDefault();
              const at = position();
              field.value = attributeGroups(
                at === undefined ? "" : view.state.doc.nodeAt(at)?.attrs.meta || "",
              );
              field.setAttribute("aria-invalid", "false");
              cm.querySelector<HTMLElement>(".cm-content")?.focus({ preventScroll: true });
            }
          };
          field.addEventListener("blur", blur);
          field.addEventListener("input", input);
          field.addEventListener("keydown", keys);
          field.readOnly = !view.editable;
          const mobile=!!view.dom.closest('.mobile-app');
          if(mobile)handle.title='长按后拖动调整高度；双击恢复默认高度';
          const disposeResize=bindCodeResize(handle,{
            mobile,enabled:()=>view.editable,
            measure:()=>heightTarget.getBoundingClientRect().height,
            value:()=>{const at=position();return at===undefined?null:heightFromMeta(view.state.doc.nodeAt(at)?.attrs.meta||'');},
            preview:height=>{heightTarget.style.height=height===null?'':height+'px';},
            commit:save,
            active:value=>{if(value)dragging.add(dom);else dragging.delete(dom);},
          });
          cleanups.set(dom, {
            cm,
            handle,
            field,
            cleanup: () => {
              disposeResize();
              field.removeEventListener("blur", blur);
              field.removeEventListener("input", input);
              field.removeEventListener("keydown", keys);
              attributes.remove();
              badge.remove();
              handle.remove();
            },
          });
          layouts.set(dom, cm);
        });
        for (const [dom, registration] of cleanups) {
          if (!alive.has(dom)) {
            registration.cleanup();
            cleanups.delete(dom);
          }
        }
      };
      const schedule = () => {
        if (!queued && !destroyed) {
          queued = true;
          queueMicrotask(scan);
        }
      };
      const observer = new MutationObserver(changes => {
        if (
          changes.some(change =>
            !(change.target instanceof Element ? change.target : change.target.parentElement)
              ?.closest(".cm-editor,.code-ui,.code-attributes")
          )
        ) schedule();
      });
      observer.observe(view.dom, { childList: true, subtree: true });
      schedule();
      return {
        update(view, previous) {
          if (!view.state.doc.eq(previous.doc)) schedule();
        },
        destroy() {
          observer.disconnect();
          destroyed = true;
          for (const registration of cleanups.values()) registration.cleanup();
        },
      };
    },
  })
);
