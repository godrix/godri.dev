"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PIX_COPIA_COLA, PIX_QR_CODE_IMAGE } from "@/data/pix";
import { cn } from "@/lib/utils";

type PixCoffeeProps = {
  variant?: "card" | "inline";
  className?: string;
};

const buttonBase =
  "border-2 border-black font-bold transition-all duration-150 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none";

export function PixCoffee({ variant = "card", className }: PixCoffeeProps) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const copyPix = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(PIX_COPIA_COLA);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, []);

  const closeQr = useCallback(() => setQrOpen(false), []);

  useEffect(() => {
    if (!qrOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeQr();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [qrOpen, closeQr]);

  const actions = (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={copyPix}
        className={cn(
          buttonBase,
          "bg-nb-primary px-4 py-2 text-sm shadow-nb hover:shadow-nb-lg",
          copied && "bg-nb-success"
        )}
      >
        {copied ? "Copiado!" : "Copiar Pix"}
      </button>
      <button
        type="button"
        onClick={() => setQrOpen(true)}
        className={cn(
          buttonBase,
          "bg-white px-4 py-2 text-sm shadow-nb hover:shadow-nb-lg"
        )}
      >
        Ver QR Code
      </button>
    </div>
  );

  return (
    <>
      {variant === "card" ? (
        <div
          className={cn(
            "border-2 border-black bg-nb-warning p-4 shadow-nb",
            className
          )}
        >
          <span className="block font-display text-base font-bold leading-tight sm:text-lg">
            Me paga um café ☕
          </span>
          <span className="mt-1 block text-sm font-medium opacity-80">
            Pix copia e cola — R$ 6,00
          </span>
          <div className="mt-3">{actions}</div>
        </div>
      ) : (
        <div className={cn("flex flex-col gap-2 sm:items-end", className)}>
          <p className="font-bold">Me paga um café ☕</p>
          {actions}
        </div>
      )}

      {qrOpen &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
            onClick={closeQr}
            role="presentation"
          >
            <div
              className="w-full max-w-sm border-[3px] border-black bg-white p-6 shadow-nb-xl"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="pix-qr-title"
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2
                    id="pix-qr-title"
                    className="font-display text-xl font-black"
                  >
                    Pix — QR Code
                  </h2>
                  <p className="mt-1 text-sm font-medium">
                    Escaneie para pagar
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeQr}
                  className={cn(
                    buttonBase,
                    "shrink-0 bg-nb-bg-secondary px-3 py-1 text-sm shadow-nb-sm"
                  )}
                  aria-label="Fechar"
                >
                  ✕
                </button>
              </div>

              <div className="mx-auto aspect-square w-full max-w-[240px] border-2 border-black bg-white p-2 shadow-nb">
                <Image
                  src={PIX_QR_CODE_IMAGE}
                  alt="QR Code Pix para pagamento"
                  width={240}
                  height={240}
                  className="h-full w-full object-contain"
                  priority
                />
              </div>

              <p className="mt-4 text-center font-mono text-xs font-bold uppercase tracking-wider">
                R$ 6,00 · Carlos G Godri
              </p>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
