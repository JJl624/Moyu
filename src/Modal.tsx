import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { isComposingKey } from './keyboardComposition';

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  initialFocus,
  restoreFocus = true,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  wide?: boolean;
  initialFocus?: string;
  restoreFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focus = (initialFocus && ref.current?.querySelector<HTMLElement>(initialFocus)) || (title === "偏好设置"
      ? ref.current?.querySelector<HTMLElement>(".modal-title button")
      : ref.current?.querySelector<HTMLElement>(".palette-input input")
        || ref.current?.querySelector<HTMLElement>("input:not([type=hidden]),textarea,select,button"));
    focus?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (isComposingKey(event)) return;
      if (ref.current !== Array.from(document.querySelectorAll(".modal[role=\"dialog\"]")).at(-1)) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
      }
      if (event.key === "Tab") {
        const elements = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input, select, textarea, [tabindex=\"0\"]",
          ) ?? [],
        );
        const first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      if(restoreFocus)previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="modal-title">
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="关闭对话框"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
