"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { navigateWithTransition, scrollToSection } from "@/lib/navigate";
import { cn } from "@/lib/utils";

type AnimatedLinkProps = {
  href: string;
  children: React.ReactNode;
  className?: string;
  scrollOnHome?: boolean;
  sectionId?: string;
  onClick?: () => void;
};

export function AnimatedLink({
  href,
  children,
  className,
  scrollOnHome,
  sectionId,
  onClick,
}: AnimatedLinkProps) {
  const router = useRouter();
  const pathname = usePathname();

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    onClick?.();

    if (scrollOnHome && sectionId && pathname === "/") {
      e.preventDefault();
      scrollToSection(sectionId);
      return;
    }

    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (href.startsWith("http")) return;

    e.preventDefault();
    navigateWithTransition(router, href);
  }

  return (
    <Link href={href} onClick={handleClick} className={className}>
      {children}
    </Link>
  );
}

type NavLinkProps = {
  href: string;
  label: string;
  sectionId?: string;
};

export function NavLink({ href, label, sectionId }: NavLinkProps) {
  const pathname = usePathname();
  const isActive =
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <AnimatedLink
      href={href}
      scrollOnHome={!!sectionId}
      sectionId={sectionId}
      className={cn(
        "border-2 border-transparent px-3 py-1.5 text-sm font-bold transition-all duration-150 sm:px-4 sm:text-base",
        isActive
          ? "border-black bg-nb-primary shadow-nb-sm"
          : "hover:border-black hover:bg-nb-bg-secondary hover:underline"
      )}
    >
      {label}
    </AnimatedLink>
  );
}
