"use client";

import { AnimatedLink } from "@/components/AnimatedLink";
import { cn } from "@/lib/utils";

type ButtonProps = {
  href?: string;
  variant?: "primary" | "secondary" | "ghost";
  children: React.ReactNode;
  className?: string;
  external?: boolean;
};

const variants = {
  primary: "bg-nb-primary hover:bg-nb-primary shadow-nb hover:shadow-nb-lg",
  secondary: "bg-white hover:bg-nb-bg-secondary shadow-nb hover:shadow-nb-lg",
  ghost: "bg-transparent hover:bg-nb-bg-secondary shadow-none hover:shadow-none",
};

const base =
  "inline-block border-2 border-black font-bold px-6 py-3 transition-all duration-150 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none";

export function Button({
  href,
  variant = "primary",
  children,
  className,
  external,
}: ButtonProps) {
  const classes = cn(base, variants[variant], className);

  if (href) {
    if (external) {
      return (
        <a
          href={href}
          className={classes}
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      );
    }
    return (
      <AnimatedLink href={href} className={classes}>
        {children}
      </AnimatedLink>
    );
  }

  return <button className={classes}>{children}</button>;
}
