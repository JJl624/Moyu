import { ChevronDown, ChevronRight, Folder, FolderOpen, MoreHorizontal } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import "./fileTreeDrag.css";
import { FileIcon } from "../FileIcon";
import { SyncBadge } from "../SyncBadge";
import { displayName, type FileNode } from "../types";
export function FileTree({
  nodes,
  active,
  expanded,
  toggle,
  open,
  keep,
  context,
  selectedFolder,
  statuses,
  showExtensions,
  dirtyPaths,
  move,
  clipboardAction,
  baseFolder = "",
  creation,
  draft,
}: {
  nodes: FileNode[];
  active: string;
  expanded: Set<string>;
  toggle(path: string): void;
  open(path: string): void;
  keep(path: string): void;
  context(event: React.MouseEvent, node: FileNode): void;
  selectedFolder: string;
  statuses: Record<string, string>;
  showExtensions: boolean;
  dirtyPaths: Set<string>;
  move(from: string, parent: string): void;
  clipboardAction(action: "cut" | "copy" | "paste", path: string, parent: string): void;
  baseFolder?: string;
  creation?: { parent: string };
  draft?: React.ReactNode;
}) {
  const source = useRef("");
  const hovered = useRef("");
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expansion = useRef({ expanded, toggle });
  expansion.current = { expanded, toggle };
  const [dragging, setDragging] = useState(false);
  const [destination, setDestination] = useState<string | null>(null);
  const clearHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    hovered.current = "";
  };
  const finishDrag = () => {
    clearHover();
    source.current = "";
    setDragging(false);
    setDestination(null);
  };
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);
  const canMove = (parent: string) =>
    !!source.current && parent !== source.current && !parent.startsWith(source.current + "/");
  const over = (event: React.DragEvent, parent: string, folder?: string) => {
    if (!source.current || !event.dataTransfer.types.includes("application/x-moyu-file")) return;
    event.preventDefault();
    event.stopPropagation();
    if (folder && canMove(folder)) {
      if (hovered.current !== folder) {
        clearHover();
        hovered.current = folder;
        if (!expanded.has(folder)) hoverTimer.current = setTimeout(() => {
          if (hovered.current === folder && !expansion.current.expanded.has(folder)) expansion.current.toggle(folder);
        }, 1000);
      }
      setDestination(folder);
    } else {
      clearHover();
      setDestination(canMove(parent) ? parent : null);
    }
    event.dataTransfer.dropEffect = canMove(parent) || !!folder ? "move" : "none";
  };
  const drop = (event: React.DragEvent, parent: string, folder?: string) => {
    const from = event.dataTransfer.getData("application/x-moyu-file");
    if (!from) return;
    event.preventDefault();
    event.stopPropagation();
    const target = folder || parent;
    const originalParent = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
    if (source.current === from && canMove(target) && target !== originalParent) move(from, target);
    finishDrag();
  };
  const folderAt = (event: React.DragEvent, node: FileNode) => {
    if (node.kind !== "folder" || node.system || node.path === source.current) return undefined;
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY > rect.top + rect.height * .2 && event.clientY < rect.bottom - rect.height * .2
      ? node.path
      : undefined;
  };
  const render = (nodes: FileNode[], depth = 0, parent = ""): React.ReactNode => (
    <>
      {creation?.parent === parent && (
        <div className="tree-new-row" style={{ paddingLeft: `min(calc(12px + ${depth} * var(--tree-indent-step,16px)),var(--tree-indent-limit,9999px))` }}>{draft}</div>
      )}
      {nodes.map((node) => (
        <div key={node.path}>
          <div
            className={`tree-row ${active === node.path ? "selected" : ""} ${
              dragging && destination === node.path ? "drag-destination" : ""
            }`}
            data-tree-path={node.path}
            draggable={!node.system && !node.companionFor}
            onDragStart={event => {
              if ((event.target as Element).closest(".tree-more")) {
                event.preventDefault();
                return;
              }
              source.current = node.path;
              setDragging(true);
              event.dataTransfer.setData("application/x-moyu-file", node.path);
              event.dataTransfer.effectAllowed = "move";
              event.stopPropagation();
            }}
            onDragEnd={finishDrag}
            onDragOver={event => over(event, parent, folderAt(event, node))}
            onDragLeave={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearHover();
            }}
            onDrop={event => drop(event, parent, folderAt(event, node))}
            style={{ paddingLeft: `min(calc(12px + ${depth} * var(--tree-indent-step,16px)),var(--tree-indent-limit,9999px))` }}
            onContextMenu={(event) => context(event, node)}
          >
            <button
              className="tree-item"
              onClick={event => {
                if (node.kind === "folder") toggle(node.path);
                else if (event.detail < 2) open(node.path);
              }}
              onDoubleClick={() => {
                if (node.kind === "file") keep(node.path);
              }}
              title={node.path}
            >
              {node.kind === "folder"
                ? (
                  <>
                    <span className="tree-chevron">
                      {expanded.has(node.path)
                        ? <ChevronDown size={13} />
                        : <ChevronRight size={13} />}
                    </span>
                    {expanded.has(node.path) ? <FolderOpen size={16} /> : <Folder size={16} />}
                  </>
                )
                : (
                  <>
                    <span className="tree-chevron" />
                    <FileIcon path={node.path} />
                  </>
                )}
              <span>
                {node.kind === "file" ? displayName(node.name, showExtensions) : node.name}
              </span>
            </button>
            {dirtyPaths.has(node.path) && (
              <span
                className="dirty-dot"
                title="本地未保存"
                aria-label={node.name + "，未保存"}
              />
            )}
            {node.kind === "file" && <SyncBadge name={node.name} state={statuses[node.path]} system={node.system} />}
            <button
              className="tree-more icon-button"
              aria-label={`操作 ${node.name}`}
              onClick={(event) => context(event, node)}
            >
              <MoreHorizontal size={15} />
            </button>
          </div>
          {node.kind === "folder"
            && expanded.has(node.path)
            && render(node.children ?? [], depth + 1, node.path)}
        </div>
      ))}
    </>
  );
  return (
    <div
      className={"file-tree" + (dragging ? " dragging-files" : "")}
      tabIndex={0}
      onDragOver={event => over(event, baseFolder)}
      onDrop={event => drop(event, baseFolder)}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          clearHover();
          setDestination(null);
        }
      }}
      onKeyDown={event => {
        if ((event.target as Element).closest("input,textarea,select")) return;
        if ((event.ctrlKey || event.metaKey) && ["x", "c", "v"].includes(event.key.toLowerCase())) {
          event.preventDefault();
          const node = (event.target as Element).closest<HTMLElement>("[data-tree-path]"),
            path = node?.dataset.treePath || active;
          clipboardAction(
            event.key.toLowerCase() === "x" ? "cut" : event.key.toLowerCase() === "c" ? "copy" : "paste",
            path,
            selectedFolder,
          );
        }
      }}
    >
      {render(nodes, 0, baseFolder)}
      {dragging && (
        <div className={"tree-root-drop" + (destination === baseFolder ? " drag-destination" : "")}>
          移动到{baseFolder || "知识库根目录"}
        </div>
      )}
    </div>
  );
}
