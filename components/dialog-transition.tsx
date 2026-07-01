"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const exitDurationMs = 180;

export function DialogTransition({
  open,
  children,
  onClose,
  titleId,
}: {
  open: boolean;
  children: ReactNode;
  onClose?: () => void;
  titleId?: string;
}) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const latestChildren = useRef<ReactNode>(children);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  if (open && children) {
    latestChildren.current = children;
  }

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return;
    }

    if (!mounted) return;

    setClosing(true);
    const timeoutId = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, exitDurationMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [mounted, open]);

  useEffect(() => {
    if (!mounted || closing) return;

    panelRef.current?.focus({ preventScroll: true });
  }, [closing, mounted]);

  useEffect(() => {
    if (!mounted) {
      previousFocusRef.current?.focus({ preventScroll: true });
      previousFocusRef.current = null;
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && onClose) {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mounted, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`dialog-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/22 p-4 backdrop-blur-[2px] ${
        closing ? "dialog-overlay-out" : "dialog-overlay-in"
      }`}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`${closing ? "dialog-panel-out" : "dialog-panel-in"} outline-none`}
      >
        {latestChildren.current}
      </div>
    </div>,
    document.body,
  );
}
