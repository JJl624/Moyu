import { ChevronDown, ChevronRight, Folder, FolderOpen, MoreHorizontal, FilePlus, FolderPlus } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import "./fileTreeDrag.css";
import { FileIcon } from "../FileIcon";
import { SyncBadge } from "../SyncBadge";
import { displayName, type FileNode } from "../types";
import { attachmentDragType } from '../editor/attachmentDrop';
import { startTreePointerDrag } from './treePointerDrag';
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
  create,
  createDisabled=false,
  root,
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
  create(kind:'new'|'folder',parent:string):void;
  createDisabled?:boolean;
  root?:string;
}) {
  const source = useRef("");
  const pointerCleanup=useRef<()=>void>(()=>{});
  const ghost=useRef<HTMLDivElement>(null);
  const suppressClick=useRef(0);
  const scrollFrame=useRef(0),scrollSpeed=useRef(0),scrollElement=useRef<HTMLElement|null>(null);
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
    cancelAnimationFrame(scrollFrame.current);scrollFrame.current=0;scrollSpeed.current=0;
    suppressClick.current=Date.now()+300;
  };
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    pointerCleanup.current();cancelAnimationFrame(scrollFrame.current);
  }, []);
  const dragData=(node:FileNode,data=new DataTransfer())=>{
    source.current=node.path;setDragging(true);
    data.setData('application/x-moyu-file',node.path);
    if(node.kind==='file')data.setData(attachmentDragType,JSON.stringify({path:node.path,root,kind:node.kind}));
    data.effectAllowed='copyMove';return data;
  };
  const scrollAt=(event:React.DragEvent)=>{
    const scroll=event.currentTarget.closest<HTMLElement>('.sidebar-scroll');if(!scroll)return;
    const box=scroll.getBoundingClientRect(),edge=30;
    scrollElement.current=scroll;
    scrollSpeed.current=event.clientY<box.top+edge?-Math.max(2,(box.top+edge-event.clientY)/3)
      :event.clientY>box.bottom-edge?Math.max(2,(event.clientY-box.bottom+edge)/3):0;
    if(scrollFrame.current||!scrollSpeed.current)return;
    const tick=()=>{const el=scrollElement.current;if(!el||!source.current||!scrollSpeed.current){scrollFrame.current=0;return;}const before=el.scrollTop;el.scrollTop+=scrollSpeed.current;if(el.scrollTop===before){scrollFrame.current=0;scrollSpeed.current=0;return;}clearHover();scrollFrame.current=requestAnimationFrame(tick);};
    scrollFrame.current=requestAnimationFrame(tick);
  };
  const dragToggle=(target:Element)=>{
    const path=target.closest<HTMLElement>('[data-tree-folder]')?.dataset.treePath;
    if(!path)return;
    clearHover();hovered.current=path;expansion.current.toggle(path);
  };
  const canMove = (parent: string) =>
    !!source.current && parent !== source.current && !parent.startsWith(source.current + "/");
  const over = (event: React.DragEvent, parent: string, folder?: string) => {
    if (!source.current || !event.dataTransfer.types.includes("application/x-moyu-file")) return;
    event.preventDefault();
    event.stopPropagation();
    scrollAt(event);
    if (folder) {
      if (hovered.current !== folder) {
        clearHover();
        hovered.current = folder;
        hoverTimer.current = setTimeout(() => {
          if (hovered.current === folder) expansion.current.toggle(folder);
        }, 2000);
      }
      setDestination(canMove(folder)?folder:null);
    } else {
      clearHover();
      setDestination(canMove(parent) ? parent : null);
    }
    event.dataTransfer.dropEffect = canMove(folder||parent) ? "move" : "none";
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
    if (node.kind !== "folder" || node.system) return undefined;
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
            data-tree-folder={node.kind==='folder'&&!node.system?'true':undefined}
            draggable={false}
            onPointerDown={event=>{
              if(event.button!==0||node.system||node.companionFor||(event.target as Element).closest('.tree-more,.tree-create'))return;
              pointerCleanup.current();
              pointerCleanup.current=startTreePointerDrag(event,{
                start:()=>dragData(node),finish:finishDrag,toggle:dragToggle,
                position:(x,y)=>{if(ghost.current)ghost.current.style.transform=`translate(${x+12}px,${y+12}px)`;},
              });
            }}
            onDragStart={event => {
              if ((event.target as Element).closest(".tree-more,.tree-create")||event.nativeEvent.isTrusted) {
                event.preventDefault();
                return;
              }
              dragData(node,event.dataTransfer);
              event.stopPropagation();
            }}
            onDragEnd={finishDrag}
            onDragOver={event => over(event, parent, folderAt(event, node))}
            onDragLeave={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearHover();
            }}
            onDrop={event => drop(event, parent, folderAt(event, node))}
            style={{ paddingLeft: `min(calc(12px + ${depth} * var(--tree-indent-step,16px)),var(--tree-indent-limit,9999px))` }}
            onContextMenu={(event) => {if(source.current){event.preventDefault();event.stopPropagation();dragToggle(event.target as Element);}else context(event, node);}}
            onClickCapture={event=>{if(Date.now()<suppressClick.current){event.preventDefault();event.stopPropagation();}}}
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
            {node.kind==='folder'&&!node.system&&<span className='tree-create'>
              <button className='icon-button' disabled={createDisabled} aria-label={'在 '+node.path+' 下新建文档'} title='新建文档' onClick={()=>create('new',node.path)}><FilePlus size={14}/></button>
              <button className='icon-button' disabled={createDisabled} aria-label={'在 '+node.path+' 下新建文件夹'} title='新建文件夹' onClick={()=>create('folder',node.path)}><FolderPlus size={14}/></button>
            </span>}
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
      onKeyDownCapture={event=>{if(['Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))event.currentTarget.dataset.keyboardFocus='true';}}
      onPointerDownCapture={event=>{delete event.currentTarget.dataset.keyboardFocus;}}
      onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))delete event.currentTarget.dataset.keyboardFocus;}}
      onDragOver={event => over(event, baseFolder)}
      onDrop={event => drop(event, baseFolder)}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          clearHover();
          setDestination(null);
          scrollSpeed.current=0;
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
      {dragging&&<div ref={ghost} className='tree-drag-label' aria-hidden='true'>{source.current.split('/').at(-1)}</div>}
      {dragging && (
        <div className={"tree-root-drop" + (destination === baseFolder ? " drag-destination" : "")}>
          移动到{baseFolder || "知识库根目录"}
        </div>
      )}
    </div>
  );
}
