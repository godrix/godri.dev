"use client";

import { startTransition } from "react";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { startPageTransition } from "@/lib/view-transition";

export function navigateWithTransition(
  router: AppRouterInstance,
  href: string
) {
  startPageTransition(() => {
    startTransition(() => router.push(href));
  });
}

export function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;

  startPageTransition(() => {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
