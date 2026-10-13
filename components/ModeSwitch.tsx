"use client";

import { Clapperboard, ImageIcon, MessageCircle } from "lucide-react";

export type Mode = "chat" | "image" | "video";

const MODES: { mode: Mode; label: string; Icon: typeof MessageCircle }[] = [
  { mode: "chat", label: "צ׳אט", Icon: MessageCircle },
  { mode: "image", label: "תמונה", Icon: ImageIcon },
  { mode: "video", label: "סרטון", Icon: Clapperboard },
];

// Composer switch between chatting and generating an image or a video. Icons only, to fit next
// to the attach button on a phone; the label is in the tooltip and the accessible name.
export default function ModeSwitch({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  return (
    <div role="radiogroup" aria-label="מה ליצור" className="flex h-9 shrink-0 items-center rounded-full bg-bubble p-0.5">
      {MODES.map(({ mode, label, Icon }) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          aria-label={label}
          title={label}
          onClick={() => onChange(mode)}
          className={`press flex size-8 items-center justify-center rounded-full transition-[background-color,color,transform] ${
            value === mode ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
          }`}
        >
          <Icon size={17} aria-hidden />
        </button>
      ))}
    </div>
  );
}
