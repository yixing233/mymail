"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
  };
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      removeToast(id);
    }, 3500);
  }, [removeToast]);

  const toast = React.useMemo(() => ({
    success: (msg: string) => addToast(msg, "success"),
    error: (msg: string) => addToast(msg, "error"),
    info: (msg: string) => addToast(msg, "info"),
  }), [addToast]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {mounted && createPortal(
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full">
          {toasts.map((t) => (
            <div
              key={t.id}
              onClick={() => removeToast(t.id)}
              className="pointer-events-auto flex items-center justify-between gap-3 rounded-[15px] border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur-md transition-all duration-300 animate-in slide-in-from-right-4 fade-in cursor-pointer hover:bg-slate-50/90"
            >
              <div className="flex items-center gap-2.5">
                {t.type === "success" && (
                  <i className="fa-solid fa-circle-check text-emerald-500 text-base" aria-hidden="true" />
                )}
                {t.type === "error" && (
                  <i className="fa-solid fa-circle-xmark text-rose-500 text-base" aria-hidden="true" />
                )}
                {t.type === "info" && (
                  <i className="fa-solid fa-circle-info text-sky-500 text-base" aria-hidden="true" />
                )}
                <span className="text-xs font-semibold text-slate-800 leading-tight">
                  {t.message}
                </span>
              </div>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-600 ml-2"
                aria-label="关闭"
              >
                <i className="fa-solid fa-xmark text-[10px]" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context.toast;
}
