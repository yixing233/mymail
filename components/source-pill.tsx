import clsx from "clsx";

export function SourcePill({
  label,
  unreadCount,
  selected,
  accent,
  onClick,
}: {
  label: string;
  unreadCount: number;
  selected: boolean;
  accent: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex w-full items-center justify-between rounded-[15px] border px-4 py-3 text-left transition",
        selected ? "border-slate-900 bg-slate-950 text-white" : "border-transparent bg-white/70 text-slate-900 hover:border-slate-200",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: selected ? "#fff" : accent }}
          aria-hidden
        />
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <span
        className={clsx(
          "rounded-full px-2 py-1 text-xs font-semibold",
          selected ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600",
        )}
      >
        {unreadCount}
      </span>
    </button>
  );
}
