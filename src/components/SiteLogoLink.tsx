import { AnimatedLink } from "@/components/AnimatedLink";
import { cn } from "@/lib/utils";

type SiteLogoLinkProps = {
  className?: string;
};

export function SiteLogoLink({ className }: SiteLogoLinkProps) {
  return (
    <AnimatedLink
      href="/"
      className={cn(
        "font-display text-2xl font-black tracking-tight transition-colors hover:bg-nb-primary hover:px-2",
        className
      )}
    >
      godri<span className="text-nb-accent">.</span>dev
    </AnimatedLink>
  );
}
