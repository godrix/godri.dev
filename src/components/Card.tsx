import { AnimatedLink } from "@/components/AnimatedLink";
import { cn } from "@/lib/utils";

type CardProps = {
  children: React.ReactNode;
  href?: string;
  className?: string;
  color?: "white" | "primary" | "secondary" | "accent" | "success" | "warning";
  hover?: boolean;
};

const bgColors = {
  white: "bg-white",
  primary: "bg-nb-primary",
  secondary: "bg-nb-secondary",
  accent: "bg-nb-accent",
  success: "bg-nb-success",
  warning: "bg-nb-warning",
};

export function Card({
  children,
  href,
  className,
  color = "white",
  hover = true,
}: CardProps) {
  const classes = cn(
    "border-2 border-black p-6 shadow-nb",
    bgColors[color],
    hover &&
      "transition-all duration-150 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-nb-lg",
    className
  );

  if (href) {
    return (
      <AnimatedLink href={href} className={cn(classes, "block")}>
        {children}
      </AnimatedLink>
    );
  }

  return <div className={classes}>{children}</div>;
}
