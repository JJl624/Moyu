import { useEffect, useRef, useState } from "react";
export function SidebarDivider(
  { width, change, side = "left" }: {
    width: number;
    change: (width: number) => void;
    side?: "left" | "right";
  },
) {
  const start = useRef({ x: 0, width }), [dragging, setDragging] = useState(false);
  useEffect(() => () => document.body.classList.remove("resizing-sidebar"), []);
  const direction = side === "right" ? -1 : 1;
  const clamp = (v: number) =>
    Math.round(Math.min(Math.max(180, Math.min(600, window.innerWidth - 400)), Math.max(180, v)));
  return (
    <div
      className={"sidebar-divider " + (side === "right" ? "right-sidebar-divider " : "")
        + (dragging ? "dragging" : "")}
      role="separator"
      aria-label={side === "right" ? "编辑器与文档信息分隔条" : "文件管理器与编辑器分隔条"}
      aria-orientation="vertical"
      aria-valuenow={clamp(width)}
      aria-valuemin={180}
      aria-valuemax={600}
      tabIndex={0}
      onPointerDown={e => {
        if (e.button) return;
        start.current = { x: e.clientX, width: clamp(width) };
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        document.body.classList.add("resizing-sidebar");
      }}
      onPointerMove={e => {
        if (dragging) {
          change(
            clamp(start.current.width + direction * (e.clientX - start.current.x)),
          );
        }
      }}
      onPointerUp={e => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(
            e.pointerId,
          );
        }
        setDragging(false);
        document.body.classList.remove("resizing-sidebar");
      }}
      onLostPointerCapture={() => {
        setDragging(false);
        document.body.classList.remove("resizing-sidebar");
      }}
      onDoubleClick={() => change(side === "right" ? 242 : 260)}
      onKeyDown={e => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          change(
            clamp(
              clamp(width) + direction * (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 20 : 5),
            ),
          );
        }
      }}
    />
  );
}
