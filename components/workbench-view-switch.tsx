"use client";

import { startTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type WorkbenchView = "mail" | "logs";

const views: Array<{
  id: WorkbenchView;
  label: string;
  icon: string;
}> = [
  { id: "mail", label: "邮箱", icon: "fa-solid fa-envelope" },
  { id: "logs", label: "运行日志", icon: "fa-solid fa-terminal" },
];

export function WorkbenchViewSwitch() {
  const router = useRouter();
  const params = useSearchParams();
  const activeView: WorkbenchView = params.get("view") === "logs" ? "logs" : "mail";
  const activeIndex = views.findIndex((item) => item.id === activeView);

  function setView(nextView: WorkbenchView) {
    const next = new URLSearchParams(params.toString());
    if (nextView === "logs") {
      next.set("view", "logs");
    } else {
      next.delete("view");
    }

    startTransition(() => {
      router.push(`/?${next.toString()}`);
    });
  }

  return (
    <div className="inline-flex rounded-[12px] border border-slate-200/70 bg-white/70 p-0.5 shadow-sm">
      <div className="relative grid grid-cols-2">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1/2 rounded-[10px] bg-slate-950 shadow-[0_8px_24px_rgba(15,23,42,0.16)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ transform: `translateX(${Math.max(0, activeIndex) * 100}%)` }}
        />
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setView(item.id)}
            className={`relative z-10 flex min-w-[84px] items-center justify-center gap-1.5 rounded-[10px] px-3 py-1 text-xs font-semibold leading-5 transition-colors duration-300 active:scale-[0.98] ${
              item.id === activeView ? "text-white" : "text-slate-600 hover:text-slate-900"
            }`}
            aria-pressed={item.id === activeView}
          >
            <i className={`${item.icon} text-[11px]`} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
