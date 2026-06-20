"use client";

import { useSearchParams } from "next/navigation";
import { ANIVERSARIO_REF } from "@/data/aniversario";

export function QueroCafeRefBanner() {
  const searchParams = useSearchParams();
  const ref = searchParams.get("ref");

  if (ref !== ANIVERSARIO_REF) return null;

  return (
    <div className="mb-6 w-full max-w-md border-2 border-black bg-nb-secondary p-4 text-center shadow-nb animate-slide-up">
      <p className="font-display text-base font-bold sm:text-lg">
        Ok, não é meu aniversário — mas eu ainda quero café ☕
      </p>
    </div>
  );
}
