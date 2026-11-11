"use client";

import { useEffect, useRef } from "react";
import type { Conversation, MediaResult } from "@/lib/history";

const MSG_FAILED = "היצירה נכשלה. נסו שוב.";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Patch = Partial<MediaResult>;

// Follows every pending generation in the history until it finishes: one short status call
// at a time, waiting the delay the server suggests (≥4s). Survives reloads, because pending
// jobs are stored in the history. "Cancel" only stops following (OpenArt keeps going).
export function useMediaPolling(
  convs: Conversation[] | null,
  update: (jobId: string, patch: Patch) => void,
  onSettled: () => void,
) {
  const running = useRef(new Set<string>());
  const stopped = useRef(new Set<string>());
  const live = useRef(true);
  const cb = useRef({ update, onSettled });
  useEffect(() => {
    cb.current = { update, onSettled };
  });

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    for (const c of convs ?? [])
      for (const m of c.messages) {
        const id = m.media?.provider !== "realistic" && m.media?.status === "pending" ? m.media.jobId : undefined;
        if (!id || running.current.has(id) || stopped.current.has(id)) continue;
        running.current.add(id);
        void follow(id).finally(() => running.current.delete(id));
      }

    async function follow(id: string) {
      for (;;) {
        const r = await fetch(`/api/media/status?id=${encodeURIComponent(id)}`)
          .then(async (res) => ({ res, body: await res.json().catch(() => null) }))
          .catch(() => null);
        if (!live.current || stopped.current.has(id)) return;
        if (!r) {
          await sleep(8000); // offline for a moment: keep trying
          continue;
        }
        if (!r.res.ok) {
          cb.current.update(id, { status: "failed", error: r.body?.error ?? MSG_FAILED });
          return cb.current.onSettled();
        }
        if (r.body.status === "running") {
          await sleep(Math.max(4, Number(r.body.pollAfter) || 4) * 1000);
          continue;
        }
        cb.current.update(
          id,
          r.body.status === "done"
            ? { status: "done", url: r.body.url, poster: r.body.poster, credits: r.body.credits }
            : { status: "failed", error: r.body.error ?? MSG_FAILED },
        );
        return cb.current.onSettled();
      }
    }
  }, [convs]);

  return {
    stop(id: string) {
      stopped.current.add(id);
      update(id, { status: "stopped" });
    },
    resume(id: string) {
      stopped.current.delete(id);
      update(id, { status: "pending" });
    },
  };
}
