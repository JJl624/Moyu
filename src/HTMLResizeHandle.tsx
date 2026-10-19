import { useEffect, useRef } from "react";

export function HTMLResizeHandle(
  { height, resize }: { height: number; resize(height: number, finished: boolean): void },
) {
  const drag = useRef<{ id: number; y: number; height: number; last: number; target: HTMLElement } | null>(
    null,
  );
  const callback = useRef(resize);
  callback.current = resize;
  const finish = () => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (current.target.hasPointerCapture(current.id)) current.target.releasePointerCapture(current.id);
    document.body.classList.remove("moyu-html-resizing");
    callback.current(current.last, true);
  };
  useEffect(() => {
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("blur", finish);
      finish();
    };
  }, []);
  return (
    <div
      className="html-result-resize"
      role="separator"
      tabIndex={0}
      aria-label="调整 HTML 预览高度"
      aria-orientation="horizontal"
      aria-valuemin={160}
      aria-valuemax={900}
      aria-valuenow={height}
      onPointerDown={event => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault();
        event.stopPropagation();
        drag.current = {
          id: event.pointerId,
          y: event.clientY,
          height,
          last: height,
          target: event.currentTarget,
        };
        document.body.classList.add("moyu-html-resizing");
        event.currentTarget.setPointerCapture(event.pointerId);
        callback.current(height, false);
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        event.preventDefault();
        current.last = Math.round(Math.max(160, Math.min(900, current.height + event.clientY - current.y)));
        callback.current(current.last, false);
      }}
      onPointerUp={event => {
        if (drag.current?.id === event.pointerId) finish();
      }}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={event => {
        const amount = event.shiftKey ? 50 : 10;
        const next = event.key === "ArrowUp" ? height - amount : event.key === "ArrowDown"
          ? height + amount
          : event.key === "Home"
          ? 160
          : event.key === "End"
          ? 900
          : null;
        if (next !== null) {
          event.preventDefault();
          event.stopPropagation();
          callback.current(Math.max(160, Math.min(900, next)), true);
        }
      }}
    >
      <span />
    </div>
  );
}
