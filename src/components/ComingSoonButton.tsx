import { cn } from "@/lib/utils";

type ComingSoonButtonProps = {
  children: React.ReactNode;
  tooltip?: string;
  className?: string;
};

export function ComingSoonButton({
  children,
  tooltip = "Em breve",
  className,
}: ComingSoonButtonProps) {
  return (
    <button
      type="button"
      disabled
      title={tooltip}
      aria-disabled="true"
      aria-label={`${children} — ${tooltip}`}
      className={cn(
        "shrink-0 cursor-not-allowed border-2 border-black bg-nb-bg-secondary px-4 py-2 text-sm font-bold opacity-60 shadow-nb-sm",
        className
      )}
    >
      {children}
    </button>
  );
}
