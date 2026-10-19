import katex from "katex";
import { codeId } from "../shared/code-documents.mjs";
import { api } from "./bridge";
import { parseCodeTabs } from "./codeTabs";
import { heightFromMeta } from "./editor/codeMetadata";
import { codeLanguage, highlightCodeElement } from "./highlight";
import { applyMermaidSize, diagramSvg } from "./Mermaid";

export async function codeTabPreview(
  language: string,
  source: string,
  meta = "",
): Promise<HTMLElement | null> {
  if (language.toLowerCase() === "mermaid") {
    const result = document.createElement("div");
    result.className = "mermaid-diagram";
    result.dataset.mermaidSource = encodeURIComponent(source);
    result.dataset.mermaidMeta = meta;
    try {
      const svg = await diagramSvg(source);
      applyMermaidSize(svg, meta);
      result.append(svg);
    } catch (error) {
      result.classList.add("diagram-error");
      result.textContent = "Mermaid：" + (error as Error).message;
    }
    return result;
  }
  if (["latex", "math"].includes(language.toLowerCase())) {
    const result = document.createElement("div");
    result.className = "tabs-math-preview";
    katex.render(source, result, { throwOnError: false, displayMode: true });
    return result;
  }
  return null;
}

// Reading view binds the controls after HTML mounting. Exports show every page
// without controls, so their content remains available without JavaScript.
export async function renderCodeTabs(
  source: string,
  meta: string,
  interactive: boolean,
  limitHeight: boolean,
) {
  const root = document.createElement("div");
  root.className = "tabbed-code tabs-reading";
  root.dataset.tabbedCode = "true";
  root.dataset.codeRaw = source;
  root.dataset.tabsDisplay = "tabs";
  const frame = document.createElement("div");
  frame.className = "tabs-frame";
  const height = heightFromMeta(meta);
  if (interactive && limitHeight && height) frame.style.height = height + "px";
  const bar = document.createElement("div");
  bar.className = "tabs-bar";
  bar.setAttribute("role", "tablist");
  bar.setAttribute("aria-label", "代码标签页");
  const pages = document.createElement("div");
  pages.className = "tabs-reading-pages";
  const tabs = parseCodeTabs(source);
  await Promise.all(tabs.map(async (tab, index) => {
    const label = tab.title || codeLanguage(tab.language || "text")?.name || tab.language;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(index === 0));
    button.tabIndex = index === 0 ? 0 : -1;
    button.dataset.codeTab = String(index);
    bar.append(button);
    const pane = document.createElement("section");
    pane.className = "tabs-pane";
    pane.dataset.codePane = String(index);
    pane.hidden = interactive && index !== 0;
    pane.setAttribute("role", "tabpanel");
    if (!interactive) {
      const heading = document.createElement("h4");
      heading.className = "tabs-export-title";
      heading.textContent = label + (tab.title ? " (" + tab.language + ")" : "");
      pane.append(heading);
    }
    const pre = document.createElement("pre"), code = document.createElement("code");
    code.dataset.tabsCode = "true";
    pre.append(code);
    const row = document.createElement("div"), numbers = document.createElement("div");
    row.className = "tabs-reading-code";
    numbers.className = "tabs-line-numbers";
    numbers.setAttribute("aria-hidden", "true");
    numbers.textContent = Array.from(
      { length: tab.code.split("\n").length },
      (_, i) => String(i + 1),
    ).join("\n");
    row.append(numbers, pre);
    pane.append(row);
    pages.append(pane);
    const preview = await codeTabPreview(tab.language, tab.code, meta);
    await highlightCodeElement(code, tab.code || " ", tab.language);
    if (preview) {
      preview.classList.add("tabs-live-preview");
      pane.append(preview);
    }
  }));
  if (interactive) {
    const tools = document.createElement("div"),
      label = document.createElement("span"),
      id = document.createElement("span"),
      actions = document.createElement("div");
    tools.className = "tabs-tools";
    label.textContent = "Tabs";
    id.className = "code-id";
    id.textContent = codeId(meta);
    id.title = "代码块 ID";
    actions.className = "tools-button-group";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = "源码";
    toggle.dataset.tabsToggle = "true";
    toggle.title = "显示源码";
    toggle.setAttribute("aria-label", toggle.title);
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "复制代码";
    copy.dataset.tabsCopy = "true";
    copy.setAttribute("aria-label", "复制代码");
    actions.append(toggle, copy);
    tools.append(label, id, actions);
    root.append(tools);
    const raw = document.createElement("pre"), code = document.createElement("code");
    raw.dataset.tabsRaw = "true";
    raw.hidden = true;
    code.textContent = source;
    raw.append(code);
    pages.append(raw);
    await highlightCodeElement(code, source, "tabs");
    frame.append(bar, pages);
  } else frame.append(pages);
  if (!tabs.length) {
    const empty = document.createElement("pre");
    empty.textContent = source || " ";
    pages.append(empty);
  }
  root.append(frame);
  return root;
}

export function bindReadingCodeTabs(root: HTMLElement) {
  const select = (block: HTMLElement, index: number) => {
    block.querySelectorAll<HTMLButtonElement>("[data-code-tab]").forEach(button => {
      const selected = Number(button.dataset.codeTab) === index;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    block.querySelectorAll<HTMLElement>("[data-code-pane]").forEach(pane =>
      pane.hidden = block.dataset.tabsDisplay === "source"
        || Number(pane.dataset.codePane) !== index
    );
  };
  const click = (event: Event) => {
    const button = (event.target as Element).closest<HTMLElement>(
        "[data-code-tab],[data-tabs-toggle],[data-tabs-copy]",
      ),
      block = button?.closest<HTMLElement>("[data-tabbed-code]");
    if (!button || !block) return;
    if (button.dataset.tabsCopy !== undefined) {
      const raw = block.dataset.codeRaw || "",
        active = Number(block.querySelector<HTMLElement>('[data-code-tab][aria-selected=true]')?.dataset.codeTab) || 0,
        text = block.dataset.tabsDisplay === 'source' ? raw : parseCodeTabs(raw)[active]?.code || '';
      void (api.desktop
        ? api.feature("clipboard.write", { text })
        : navigator.clipboard.writeText(text)).catch(console.error);
      event.stopPropagation();
      return;
    }
    if (button.dataset.codeTab !== undefined) {
      block.dataset.tabsDisplay = "tabs";
      block.querySelector<HTMLElement>("[data-tabs-raw]")!.hidden = true;
      const toggle = block.querySelector<HTMLElement>("[data-tabs-toggle]")!;
      toggle.textContent = "源码";
      toggle.setAttribute("aria-label", "显示源码");
      select(block, Number(button.dataset.codeTab));
    } else {
      const source = block.dataset.tabsDisplay !== "source";
      block.dataset.tabsDisplay = source ? "source" : "tabs";
      button.textContent = source ? "标签页" : "源码";
      button.setAttribute("aria-label", source ? "显示标签页" : "显示源码");
      block.querySelector<HTMLElement>("[data-tabs-raw]")!.hidden = !source;
      select(
        block,
        Number(block.querySelector<HTMLElement>("[aria-selected=true]")?.dataset.codeTab) || 0,
      );
    }
    event.stopPropagation();
  };
  const keys = (event: KeyboardEvent) => {
    const button = (event.target as Element).closest<HTMLElement>("[data-code-tab]"),
      block = button?.closest<HTMLElement>("[data-tabbed-code]");
    if (!button || !block) return;
    const tabs = [...block.querySelectorAll<HTMLButtonElement>("[data-code-tab]")],
      index = Number(button.dataset.codeTab);
    const next = event.key === "ArrowRight"
      ? (index + 1) % tabs.length
      : event.key === "ArrowLeft"
      ? (index + tabs.length - 1) % tabs.length
      : event.key === "Home"
      ? 0
      : event.key === "End"
      ? tabs.length - 1
      : -1;
    if (next >= 0) {
      event.preventDefault();
      tabs[next].click();
      tabs[next].focus();
    }
  };
  root.addEventListener("click", click);
  root.addEventListener("keydown", keys);
  return () => {
    root.removeEventListener("click", click);
    root.removeEventListener("keydown", keys);
  };
}
