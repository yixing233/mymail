"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";

export type ContextMenuItem = {
  label: string;
  icon: string;
  onClick: () => void;
  danger?: boolean;
};

type ContextMenuState = {
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
};

type ContextMenuContextType = {
  showMenu: (event: React.MouseEvent | MouseEvent, items: ContextMenuItem[]) => void;
  hideMenu: () => void;
};

const ContextMenuContext = createContext<ContextMenuContextType | undefined>(undefined);

export function ContextMenuProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const [state, setState] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    items: [],
  });

  const menuRef = useRef<HTMLDivElement>(null);

  const showMenu = (event: React.MouseEvent | MouseEvent, items: ContextMenuItem[]) => {
    event.preventDefault();
    event.stopPropagation();

    let x = event.clientX;
    let y = event.clientY;
    const menuWidth = 160;
    const menuHeight = items.length * 36 + 16; // 粗略计算高度

    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 8;
    }
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 8;
    }

    setState({
      visible: true,
      x,
      y,
      items,
    });
  };

  const hideMenu = () => {
    setState((prev) => ({ ...prev, visible: false }));
  };

  const handleGlobalRefresh = async () => {
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      if (!response.ok) throw new Error("同步失败");
      toast.success("已开始后台同步全部邮箱");
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "同步失败");
    }
  };

  const handleGlobalMarkAllRead = async () => {
    try {
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source: "all" }),
      });
      if (!response.ok) throw new Error("操作失败");
      toast.success("已将全部邮件标记为已读");
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    }
  };

  useEffect(() => {
    const handleGlobalContextMenu = (e: MouseEvent) => {
      // 豁免输入框的右键行为，以允许原生的复制/粘贴
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea")) {
        return;
      }

      e.preventDefault();

      showMenu(e, [
        {
          label: "刷新全部邮件",
          icon: "fa-solid fa-rotate",
          onClick: handleGlobalRefresh,
        },
        {
          label: "一键已读全部",
          icon: "fa-solid fa-envelope-open",
          onClick: handleGlobalMarkAllRead,
        },
        {
          label: "应用设置",
          icon: "fa-solid fa-gear",
          onClick: () => {
            window.dispatchEvent(new CustomEvent("open-settings"));
          },
        },
      ]);
    };

    const handleGlobalClick = () => {
      hideMenu();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        hideMenu();
      }
    };

    window.addEventListener("click", handleGlobalClick);
    window.addEventListener("contextmenu", handleGlobalContextMenu);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", handleGlobalClick);
      window.removeEventListener("contextmenu", handleGlobalContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [router, toast]);

  return (
    <ContextMenuContext.Provider value={{ showMenu, hideMenu }}>
      {children}
      {state.visible && (
        <div
          ref={menuRef}
          style={{ top: state.y, left: state.x }}
          className="fixed z-[100] w-40 overflow-hidden rounded-[15px] border border-slate-200/80 bg-white/90 p-1.5 shadow-[0_10px_40px_rgba(15,23,42,0.08)] backdrop-blur-md transition-all duration-100 animate-in fade-in zoom-in-95 pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {state.items.map((item, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                item.onClick();
                hideMenu();
              }}
              className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left text-xs font-semibold transition ${
                item.danger
                  ? "text-rose-500 hover:bg-rose-50"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              <i className={`${item.icon} w-3.5 text-center text-xs`} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </ContextMenuContext.Provider>
  );
}

export function useContextMenu() {
  const context = useContext(ContextMenuContext);
  if (!context) {
    throw new Error("useContextMenu must be used within a ContextMenuProvider");
  }
  return context;
}
