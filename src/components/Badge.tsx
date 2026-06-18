import { cn } from "@/lib/utils";

type BadgeProps = {
  children: React.ReactNode;
  color?: "primary" | "secondary" | "accent" | "success" | "warning" | "white";
  className?: string;
};

const colors = {
  primary: "bg-nb-primary",
  secondary: "bg-nb-secondary",
  accent: "bg-nb-accent",
  success: "bg-nb-success",
  warning: "bg-nb-warning",
  white: "bg-white",
};

export function Badge({ children, color = "accent", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-block border-2 border-black px-2.5 py-1 font-mono text-xs font-bold uppercase tracking-wider shadow-nb-sm",
        colors[color],
        className
      )}
    >
      {children}
    </span>
  );
}
