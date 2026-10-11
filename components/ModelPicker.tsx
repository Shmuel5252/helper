"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { PublicModel } from "@/lib/models";
import { exhaustedLabel, isExhausted, type Exhausted } from "@/lib/quota";

// Compact model selector for the chat header: a bottom sheet on mobile, a dropdown on desktop
// (same markup, switched with lg: classes). Options whose daily quota ran out get a badge but
// stay selectable: the user decides.
export default function ModelPicker({
  models,
  value,
  onChange,
  exhausted,
  now,
  attention,
}: {
  models: PublicModel[];
  value: string | undefined;
  onChange: (key: string) => void;
  exhausted: Exhausted;
  now: number;
  attention: number; // bump to briefly highlight the button
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = models.find((m) => m.key === value) ?? models[0];
  const currentOut = isExhausted(exhausted, current.group, now);

  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]");
    const checked = menuRef.current?.querySelector<HTMLElement>("[aria-checked=true]");
    (checked ?? items?.[0])?.focus();
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") close(false);
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`בחירת מודל, כרגע: ${current.label}${currentOut ? " (נגמרה המכסה היומית)" : ""}`}
        data-exhausted={currentOut || undefined}
        className="press relative flex h-8 max-w-28 items-center gap-1 rounded-full bg-bubble ps-2.5 pe-1.5 text-[14px] font-medium text-muted transition-[background-color,color,transform] hover:bg-line hover:text-fg aria-expanded:bg-line aria-expanded:text-fg"
      >
        <span className="truncate">{current.label}</span>
        {currentOut && <span aria-hidden className="size-2 shrink-0 rounded-full bg-warn" />}
        <ChevronDown size={15} aria-hidden className="mt-px shrink-0" />
        {/* Re-mounted on every bump so the highlight replays. */}
        {attention > 0 && <span key={attention} aria-hidden className="attention pointer-events-none absolute inset-0 rounded-full" />}
      </button>

      {open && (
        <>
          <div aria-hidden onClick={() => close(false)} className="fade-in fixed inset-0 z-40 bg-black/40 lg:bg-transparent" />
          <div
            ref={menuRef}
            role="menu"
            aria-label="בחירת מודל"
            onKeyDown={onKeyDown}
            // Mobile: bottom sheet. Desktop: popover opening upward from the chip, aligned to its end edge.
            className="sheet-in fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-surface p-2 pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-2xl lg:absolute lg:inset-x-auto lg:inset-e-0 lg:top-auto lg:bottom-full lg:mb-2 lg:w-80 lg:rounded-2xl lg:border lg:border-line lg:p-1.5 lg:shadow-lg"
          >
            <div aria-hidden className="mx-auto mt-1 mb-2 h-1 w-10 rounded-full bg-line lg:hidden" />
            <p className="px-3 pt-1 pb-1.5 text-[13px] font-medium text-muted">בחירת מודל</p>
            {models.map((m) => {
              const out = isExhausted(exhausted, m.group, now);
              return (
              <button
                key={m.key}
                type="button"
                role="menuitemradio"
                aria-checked={m.key === current.key}
                onClick={() => {
                  onChange(m.key);
                  close(true);
                }}
                className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-start outline-none transition-colors hover:bg-bubble focus-visible:bg-bubble"
              >
                <span className="min-w-0 flex-1">
                  <span className={`block text-base leading-snug font-medium ${out ? "text-muted" : ""}`}>{m.label}</span>
                  <span className="block text-[14px] leading-snug text-muted">
                    {m.description && `${m.description} · `}
                    {/* LTR island inside the RTL row, so "Gemini 3.6 Flash" reads correctly. */}
                    <span dir="ltr" className="whitespace-nowrap">
                      {m.modelName}
                    </span>
                  </span>
                  {/* Part of the option's text, so screen readers hear it with the label. */}
                  {out && (
                    <span className="mt-1 flex items-center gap-1.5 text-[13px] leading-snug text-warn">
                      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warn" />
                      {exhaustedLabel(exhausted[m.group], now)}
                    </span>
                  )}
                </span>
                <Check
                  size={18}
                  aria-hidden
                  className={`mt-0.5 shrink-0 text-accent ${m.key === current.key ? "" : "invisible"}`}
                />
              </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
