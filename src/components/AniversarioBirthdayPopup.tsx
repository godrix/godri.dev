"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AniversarioPix } from "@/components/AniversarioPix";
import { getBrazilDateParts, isAniversarioDay } from "@/data/aniversario";
import { cn } from "@/lib/utils";

const CONFETTI_COLORS = [
  "bg-nb-primary",
  "bg-nb-secondary",
  "bg-nb-accent",
  "bg-nb-success",
  "bg-nb-warning",
];

const buttonBase =
  "border-2 border-black font-bold transition-all duration-150 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none";

type AniversarioBirthdayPopupProps = {
  storageKey?: string;
};

export function AniversarioBirthdayPopup({
  storageKey = "aniversario-popup",
}: AniversarioBirthdayPopupProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    if (!isAniversarioDay()) return;

    const { year } = getBrazilDateParts();
    const key = `${storageKey}-${year}`;
    if (sessionStorage.getItem(key)) return;

    setOpen(true);
    sessionStorage.setItem(key, "1");
  }, [storageKey]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4"
      onClick={close}
      role="presentation"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {Array.from({ length: 40 }).map((_, index) => (
          <span
            key={index}
            className={cn(
              "absolute h-3 w-3 border border-black",
              CONFETTI_COLORS[index % CONFETTI_COLORS.length],
              "animate-confetti-fall"
            )}
            style={{
              left: `${(index * 17) % 100}%`,
              animationDelay: `${(index % 10) * 0.15}s`,
              animationDuration: `${2.5 + (index % 5) * 0.3}s`,
            }}
          />
        ))}
      </div>

      <div
        className="relative w-full max-w-md border-[3px] border-black bg-white p-6 shadow-nb-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="aniversario-popup-title"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-nb-accent">
              🎉 Festa!
            </p>
            <h2
              id="aniversario-popup-title"
              className="font-display text-2xl font-black sm:text-3xl"
            >
              Hoje é meu aniversário!
            </h2>
            <p className="mt-2 text-sm font-medium">
              Se quiser mandar um presente, o Pix tá aqui embaixo.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className={cn(
              buttonBase,
              "shrink-0 bg-nb-bg-secondary px-3 py-1 text-sm shadow-nb-sm"
            )}
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <AniversarioPix />
      </div>
    </div>,
    document.body
  );
}
