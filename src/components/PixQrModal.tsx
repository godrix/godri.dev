"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const closeButtonClass =
  "shrink-0 border-2 border-black bg-nb-bg-secondary px-3 py-1 text-sm font-bold shadow-nb-sm transition-all duration-150 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none";

function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    const html = document.documentElement;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;

    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    return () => {
      html.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [locked]);
}

type PixQrModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  footer: string;
  children: ReactNode;
};

export function PixQrModal({
  open,
  onClose,
  title,
  subtitle,
  footer,
  children,
}: PixQrModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-x-hidden overflow-y-auto overscroll-contain bg-black/60 p-4 sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="my-auto w-full min-w-0 max-w-sm border-[3px] border-black bg-white p-4 shadow-nb sm:p-6"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pix-qr-title"
      >
        <div className="mb-4 flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="pix-qr-title"
              className="font-display text-lg font-black sm:text-xl"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm font-medium">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={closeButtonClass}
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="min-w-0">{children}</div>

        <p className="mt-4 text-center font-mono text-xs font-bold uppercase tracking-wider">
          {footer}
        </p>
      </div>
    </div>,
    document.body
  );
}

export function PixQrImage({
  src,
  alt,
}: {
  src: string;
  alt: string;
}) {
  return (
    <div className="mx-auto aspect-square w-full max-w-[min(100%,15rem)] border-2 border-black bg-white p-2 shadow-nb">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        width={240}
        height={240}
        className="block h-auto max-h-full w-full object-contain"
      />
    </div>
  );
}
