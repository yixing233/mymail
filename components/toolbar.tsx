"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { MailFilter } from "@/lib/types";

const filters: { id: MailFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "unread", label: "未读" },
  { id: "verification", label: "验证码" },
];

export function Toolbar() {
  const router = useRouter();
  const params = useSearchParams();
  const selected = (params.get("filter") as MailFilter | null) ?? "all";
  const selectedIndex = Math.max(
    0,
    filters.findIndex((item) => item.id === selected),
  );

  function setFilter(next: MailFilter) {
    const nextParams = new URLSearchParams(params.toString());
    nextParams.set("filter", next);
    router.push(`/?${nextParams.toString()}`);
  }

  return (
    <div className="inline-flex rounded-[12px] border border-slate-200/70 bg-white/70 p-0.5 shadow-sm">
      <div className="relative grid grid-cols-3">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1/3 rounded-[10px] bg-slate-950 shadow-[0_8px_24px_rgba(15,23,42,0.16)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ transform: `translateX(${selectedIndex * 100}%)` }}
        />
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={`relative z-10 min-w-[52px] rounded-[10px] px-2.5 py-1 text-xs font-semibold leading-5 transition-colors duration-300 ${
              item.id === selected ? "text-white" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
