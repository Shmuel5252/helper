"use client";

import { Clapperboard, Download, Pencil } from "lucide-react";
import type { MediaResult } from "@/lib/history";

// One OpenArt generation in the chat: progress while it runs, then the image or an inline
// video, actions, and a label with the option and its cost. URLs are same-origin (/media/...).
export default function MediaCard({
  m,
  onView,
  onToVideo,
  onEdit,
  onStop,
  onResume,
}: {
  m: MediaResult;
  onView: (url: string) => void;
  onToVideo: (url: string) => void;
  onEdit: (url: string) => void;
  onStop: () => void;
  onResume: () => void;
}) {
  const video = m.kind === "video";
  const action =
    "press flex h-9 items-center gap-1.5 rounded-full px-3 text-[14px] text-muted transition-[background-color,color,transform] hover:bg-bubble hover:text-fg";

  return (
    <div className="space-y-2" data-media-status={m.status}>
      {m.status === "pending" && (
        <div
          role="status"
          className={`flex w-full max-w-sm flex-col items-center justify-center gap-3 rounded-2xl bg-bubble p-6 text-center ${
            video ? "aspect-video" : "aspect-square"
          }`}
        >
          <div aria-hidden className="dots flex h-4 items-center gap-1.5 text-muted">
            <span />
            <span />
            <span />
          </div>
          <p className="text-[15px] text-muted">{video ? "יוצר סרטון… זה יכול לקחת כמה דקות" : "יוצר תמונה…"}</p>
          <button type="button" onClick={onStop} className="press rounded-full px-3 py-1 text-[14px] text-muted underline-offset-2 hover:text-fg hover:underline">
            ביטול
          </button>
        </div>
      )}

      {m.status === "done" && m.url && !video && (
        <button
          type="button"
          onClick={() => onView(m.url!)}
          aria-label="הגדלת התמונה"
          className="press block w-full max-w-sm overflow-hidden rounded-2xl bg-bubble transition-transform"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- same-origin proxied result */}
          <img src={m.url} alt={m.prompt} className="block h-auto w-full" decoding="async" />
        </button>
      )}

      {m.status === "done" && m.url && video && (
        <video
          src={m.url}
          poster={m.poster}
          controls
          playsInline
          preload="metadata"
          aria-label={m.prompt}
          className="block aspect-video w-full max-w-xl rounded-2xl bg-black"
        />
      )}

      {m.status === "failed" && (
        <p role="alert" className="text-danger">
          {m.error}
        </p>
      )}

      {m.status === "stopped" && (
        <p className="text-muted">
          הפסקתם לעקוב אחרי היצירה.{" "}
          <button type="button" onClick={onResume} className="text-accent underline underline-offset-2">
            המשך מעקב
          </button>
        </p>
      )}

      {m.status === "done" && m.url && (
        <div className="-ms-2 flex flex-wrap items-center gap-1">
          <a href={`${m.url}?download=1`} download className={action}>
            <Download size={16} aria-hidden />
            הורדה
          </a>
          {!video && (
            <>
              <button type="button" onClick={() => onToVideo(m.url!)} className={action}>
                <Clapperboard size={16} aria-hidden />
                הפוך לסרטון
              </button>
              <button type="button" onClick={() => onEdit(m.url!)} className={action}>
                <Pencil size={16} aria-hidden />
                ערוך
              </button>
            </>
          )}
        </div>
      )}

      {m.status !== "failed" && (
        <p className="text-[13px] text-muted" data-testid="media-label">
          {video ? "סרטון" : "תמונה"}{!m.provider&&<> · {m.label} · {m.credits} קרדיטים</>}
        </p>
      )}
    </div>
  );
}
