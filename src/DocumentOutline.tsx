import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { headingTree, type OutlineHeading, type OutlineNode } from "../shared/document-outline.mjs";
import type { EditorHandle } from "./editorTypes";
import "./documentOutline.css";
export function DocumentOutline(
  { headings, mode, editor, navigate }: {
    headings: OutlineHeading[];
    mode: string;
    editor: RefObject<EditorHandle | null>;
    navigate(index: number, offset: number): boolean;
  },
) {
  const tree = useMemo(() => headingTree(headings), [headings]);
  const [closed, setClosed] = useState<Set<number>>(new Set()),
    [active, setActive] = useState(0),
    [focused, setFocused] = useState(0);
  const element = useRef<HTMLDivElement>(null);
  const previousHeadings = useRef(headings);
  const navigateFrame = useRef(0), navigateCallback = useRef(navigate);
  navigateCallback.current = navigate;
  useEffect(() => () => cancelAnimationFrame(navigateFrame.current), [mode]);
  const go = (index: number, offset: number) => {
    cancelAnimationFrame(navigateFrame.current);
    let attempts = 0;
    const apply = () => {
      if (!navigateCallback.current(index, offset) && ++attempts < 300) {
        navigateFrame.current = requestAnimationFrame(apply);
      }
    };
    apply();
  };
  useEffect(() => {
    const before = previousHeadings.current;
    previousHeadings.current = headings;
    setFocused(previous => Math.min(previous, Math.max(0, headings.length - 1)));
    setClosed(previous =>
      new Set([...previous].flatMap(index => {
        const old = before[index];
        if (!old) return [];
        const occurrence = before.slice(0, index).filter(h => h.text === old.text && h.level === old.level).length;
        const matches = headings.flatMap((h, i) => h.text === old.text && h.level === old.level ? [i] : []);
        const next = matches[occurrence]
          ?? (headings.length === before.length && headings[index]?.level === old.level ? index : undefined);
        return next === undefined ? [] : [next];
      }))
    );
  }, [headings]);
  useEffect(() => {
    const scroll = document.querySelector<HTMLElement>(".document-scroll");
    if (!scroll) return;
    let frame = 0, dirty = true, positions: number[] = [];
    const scan = () => {
      frame = 0;
      if (mode === "source") {
        const offset = editor.current?.visibleOffset?.();
        if (offset !== undefined) {
          let index = 0;
          for (let i = 0; i < headings.length; i++) {
            if (headings[i].offset > offset) break;
            index = i;
          }
          setActive(index);
        }
        return;
      }
      if (dirty) {
        dirty = false;
        const root = scroll.getBoundingClientRect().top;
        const nodes = [
          ...scroll.querySelectorAll<HTMLElement>(
            mode === "read"
              ? ".reading-view h1,.reading-view h2,.reading-view h3,.reading-view h4,.reading-view h5,.reading-view h6"
              : ".ProseMirror h1,.ProseMirror h2,.ProseMirror h3,.ProseMirror h4,.ProseMirror h5,.ProseMirror h6",
          ),
        ];
        positions = nodes.map(node => node.getBoundingClientRect().top - root + scroll.scrollTop);
      }
      const top = scroll.scrollTop + 60;
      let left = 0, right = positions.length;
      while (left < right) {
        const mid = (left + right) >> 1;
        if (positions[mid] <= top) left = mid + 1;
        else right = mid;
      }
      const atEnd = scroll.scrollTop > 0 && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 2;
      setActive(atEnd ? Math.max(0, positions.length - 1) : Math.max(0, left - 1));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(scan);
    };
    const resize = new ResizeObserver(() => {
      dirty = true;
      schedule();
    });
    resize.observe(scroll);
    const content = scroll.querySelector<HTMLElement>(".ProseMirror,.reading-view");
    if (content) resize.observe(content);
    const onScroll = (event: Event) => {
      if (event.target === scroll || (event.target as Element).matches?.(".source-editor .cm-scroller")) schedule();
    };
    const changes = new MutationObserver(records => {
      if (
        records.some(record => {
          const target = record.target instanceof Element ? record.target : record.target.parentElement;
          if (target?.closest(".milkdown-code-block,.code-result,.cm-editor")) return false;
          return target?.closest("h1,h2,h3,h4,h5,h6")
            || [...record.addedNodes, ...record.removedNodes].some(node =>
              node instanceof Element
              && (node.matches(".ProseMirror,.reading-view,.source-editor,.cm-editor,h1,h2,h3,h4,h5,h6")
                || !!node.querySelector("h1,h2,h3,h4,h5,h6"))
            );
        })
      ) {
        dirty = true;
        const current = scroll.querySelector<HTMLElement>(".ProseMirror,.reading-view");
        if (current) resize.observe(current);
        schedule();
      }
    });
    changes.observe(scroll, { subtree: true, childList: true });
    scroll.addEventListener("scroll", onScroll, true);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
      scroll.removeEventListener("scroll", onScroll, true);
    };
  }, [headings, mode, editor]);
  const toggle = (index: number) => {
    setFocused(index);
    setClosed(previous => {
      const next = new Set(previous);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
    element.current?.querySelector<HTMLButtonElement>("[data-index=\"" + index + "\"]")?.focus();
  };
  const contains = (node: OutlineNode, index: number): boolean =>
    node.index === index || node.children.some(child => contains(child, index));
  const items = (nodes: OutlineNode[], parent?: number) => (
    <ul
      role={parent === undefined ? "tree" : "group"}
      aria-label={parent === undefined ? "文档大纲" : undefined}
      className="outline-tree"
    >
      {nodes.map(node => (
        <li key={node.index}>
          <div
            className={"outline-entry" + (active === node.index
              ? " current"
              : closed.has(node.index) && contains(node, active)
              ? " contains-current"
              : "")
              + (node.depth === 0 ? " root-heading" : "")}
            style={{ paddingLeft: 8 + node.depth * 14 }}
          >
            <button
              className="outline-chevron"
              tabIndex={-1}
              aria-label={(closed.has(node.index) ? "展开 " : "折叠 ") + (node.text || "无标题")}
              disabled={!node.children.length}
              onClick={() => toggle(node.index)}
            >
              {node.children.length
                ? (closed.has(node.index) ? <ChevronRight size={13} /> : <ChevronDown size={13} />)
                : <span />}
            </button>
            <button
              className="outline-heading"
              role="treeitem"
              aria-level={node.depth + 1}
              aria-expanded={node.children.length ? !closed.has(node.index) : undefined}
              aria-current={active === node.index ? "location" : undefined}
              tabIndex={focused === node.index ? 0 : -1}
              title={node.text || "无标题"}
              onFocus={() => setFocused(node.index)}
              onClick={() => {
                setActive(node.index);
                go(node.index, node.offset);
              }}
              onKeyDown={event => {
                const entries = [...element.current!.querySelectorAll<HTMLButtonElement>("[role=treeitem]")],
                  index = entries.indexOf(event.currentTarget);
                let target: HTMLButtonElement | undefined;
                if (event.key === "ArrowDown") target = entries[index + 1];
                else if (event.key === "ArrowUp") target = entries[index - 1];
                else if (event.key === "Home") target = entries[0];
                else if (event.key === "End") target = entries.at(-1);
                else if (event.key === "ArrowRight" && node.children.length) {
                  if (closed.has(node.index)) toggle(node.index);
                  else target = entries[index + 1];
                } else if (event.key === "ArrowLeft") {
                  if (node.children.length && !closed.has(node.index)) toggle(node.index);
                  else if (parent !== undefined) {
                    target = entries.find(button => button.dataset.index === String(parent));
                  }
                } else return;
                event.preventDefault();
                event.stopPropagation();
                target?.focus();
              }}
              data-index={node.index}
            >
              <span>{node.text || "无标题"}</span>
            </button>
          </div>
          {node.children.length > 0 && !closed.has(node.index) && items(node.children, node.index)}
        </li>
      ))}
    </ul>
  );
  const branches = headings.map((_, i) => i).filter(index => {
    const next = headings[index + 1];
    return next && next.level > headings[index].level;
  });
  return (
    <div className="document-outline" ref={element}>
      {headings.length > 0
        ? (
          <>
            <div className="outline-tools">
              <button
                className="icon-button"
                title="展开全部"
                aria-label="展开全部"
                disabled={!closed.size}
                onClick={() => setClosed(new Set())}
              >
                <ChevronsUpDown size={14} />
              </button>
              <button
                className="icon-button"
                title="折叠全部"
                aria-label="折叠全部"
                disabled={!branches.length}
                onClick={() => {
                  setClosed(new Set(branches));
                  setFocused(0);
                }}
              >
                <ChevronsDownUp size={14} />
              </button>
            </div>
            {items(tree)}
          </>
        )
        : <p className="outline-empty">暂无标题</p>}
    </div>
  );
}
