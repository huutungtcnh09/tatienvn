import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function AdvancedFiltersPopover({ children, activeCount = 0 }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12, width: 460, maxHeight: 320, ready: false });
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const badgeClassName =
    activeCount >= 3 ? "advanced-filter-badge advanced-filter-badge--deep" : "advanced-filter-badge";

  useEffect(() => {
    const onPointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      if (
        rootRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }

      setOpen(false);
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return undefined;

    const margin = 12;
    const gap = 6;

    const updatePosition = () => {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const nextWidth = Math.min(460, Math.max(280, window.innerWidth - margin * 2));
      const popRect = popoverRef.current?.getBoundingClientRect();
      const popWidth = Math.min(popRect?.width || nextWidth, window.innerWidth - margin * 2);
      const popHeight = popRect?.height || 320;

      const alignedLeft = Math.min(triggerRect.right - popWidth, window.innerWidth - margin - popWidth);
      const fallbackLeft = Math.min(triggerRect.left, window.innerWidth - margin - popWidth);
      const left = Math.max(margin, triggerRect.left + popWidth > window.innerWidth - margin ? alignedLeft : fallbackLeft);

      const spaceBelow = window.innerHeight - triggerRect.bottom - margin;
      const spaceAbove = triggerRect.top - margin;
      const openUp = spaceBelow < Math.min(popHeight, 320) && spaceAbove > spaceBelow;
      const unclampedTop = openUp ? triggerRect.top - popHeight - gap : triggerRect.bottom + gap;
      const maxTop = window.innerHeight - margin - Math.min(popHeight, window.innerHeight - margin * 2);
      const top = Math.max(margin, Math.min(unclampedTop, maxTop));
      const maxHeight = Math.max(180, window.innerHeight - top - margin);

      setPosition({
        left,
        top,
        width: nextWidth,
        maxHeight,
        ready: true
      });
    };

    updatePosition();

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <div className="advanced-filter-wrap" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="btn-secondary filter-advanced-btn"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        Nâng cao
        {activeCount > 0 ? <span className={badgeClassName}>{activeCount}</span> : null}
      </button>

      {open
        ? createPortal(
            <div
              ref={popoverRef}
              className="advanced-filter-popover"
              role="dialog"
              aria-label="Bộ lọc nâng cao"
              style={{
                left: `${position.left}px`,
                top: `${position.top}px`,
                width: `${position.width}px`,
                maxHeight: `${position.maxHeight}px`,
                visibility: position.ready ? "visible" : "hidden"
              }}
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
