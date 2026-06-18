export type NbColor = "primary" | "secondary" | "accent" | "success" | "warning" | "white";

const colorMap: Record<NbColor, string> = {
  primary: "bg-nb-primary",
  secondary: "bg-nb-secondary",
  accent: "bg-nb-accent",
  success: "bg-nb-success",
  warning: "bg-nb-warning",
  white: "bg-white",
};

export function nbColorClass(color: NbColor): string {
  return colorMap[color];
}

export function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
