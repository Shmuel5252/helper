"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { Ellipsis, PanelRightClose, Pencil, Pin, PinOff, SquarePen, Trash2, X } from "lucide-react";
import { groupConversations, type Conversation } from "@/lib/history";

type Props = {
  conversations: Conversation[] | null; // null until loaded from storage

  activeId: string | null;
  open: boolean; // mobile drawer
  collapsed: boolean; // desktop sidebar
  isDesktop: boolean;
  onClose: () => void;
  onCollapse: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  footer?: string; // e.g. today's generation credits vs. the daily cap
};

export default function Sidebar(props: Props) {
  const { conversations, activeId, open, collapsed, isDesktop, onClose, onCollapse, onNew, footer } = props;
  const panelRef = useRef<HTMLElement>(null);
  const modal = open && !isDesktop;

  useEffect(() => {
    if (modal) panelRef.current?.focus();
  }, [modal]);

  // Escape closes the drawer wherever focus is. Window listeners run after React's handlers,
  // so a menu or rename field that handled Escape (preventDefault) keeps the drawer open.
  useEffect(() => {
    if (!modal) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, onClose]);

  // Only after load: grouping reads the clock, which must not happen during prerender.
  const groups = conversations ? groupConversations(conversations) : [];

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/40 transition-opacity duration-200 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        ref={panelRef}
        role={isDesktop ? undefined : "dialog"}
        aria-modal={modal || undefined}
        aria-label="היסטוריית שיחות"
        tabIndex={-1}
        data-open={open || undefined}
        // The drawer sits at the inline start (right in RTL); translate-x-full pushes it off that edge.
        // Open state uses translate-none: any translate value would trap the fixed-position row menu.
        className={`drawer fixed inset-y-0 start-0 z-40 flex w-[85%] max-w-80 flex-col bg-side pt-[env(safe-area-inset-top)] shadow-2xl outline-none ${
          open ? "visible translate-none" : "invisible translate-x-full"
        } lg:visible lg:sticky lg:top-0 lg:bottom-auto lg:self-start lg:z-auto lg:h-dvh lg:w-[280px] lg:max-w-none lg:shrink-0 lg:translate-none lg:border-e lg:border-line lg:shadow-none ${
          collapsed ? "lg:hidden" : ""
        }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between ps-4 pe-2">
          <span className="text-[15px] font-semibold text-muted">שיחות</span>
          <button
            type="button"
            onClick={isDesktop ? onCollapse : onClose}
            aria-label={isDesktop ? "הסתרת רשימת השיחות" : "סגירת רשימת השיחות"}
            title={isDesktop ? "הסתרת רשימת השיחות" : "סגירה"}
            className="press flex size-10 items-center justify-center rounded-full text-muted transition-[background-color,color,transform] hover:bg-bubble hover:text-fg"
          >
            {isDesktop ? <PanelRightClose size={20} aria-hidden /> : <X size={20} aria-hidden />}
          </button>
        </div>

        <div className="px-2">
          <button
            type="button"
            onClick={onNew}
            className="press flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-[15px] transition-[background-color,transform] hover:bg-bubble"
          >
            <SquarePen size={18} aria-hidden className="text-muted" />
            שיחה חדשה
          </button>
        </div>

        <nav
          aria-label="שיחות קודמות"
          className="mt-3 flex-1 overflow-y-auto overscroll-contain px-2 pb-[max(env(safe-area-inset-bottom),1rem)]"
        >
          {!conversations ? null : groups.length === 0 ? (
            <p className="px-3 py-2 text-[15px] text-muted">אין עדיין שיחות</p>
          ) : (
            groups.map((g) => (
              <section key={g.label} className="mb-4">
                <h3 className="px-3 pb-1 text-[13px] font-medium text-muted">{g.label}</h3>
                <ul>
                  {g.items.map((c) => (
                    <Row
                      key={c.id}
                      c={c}
                      active={c.id === activeId}
                      onSelect={props.onSelect}
                      onRename={props.onRename}
                      onTogglePin={props.onTogglePin}
                      onDelete={props.onDelete}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </nav>
        {footer && (
          <p data-testid="credit-usage" className="shrink-0 border-t border-line px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] text-[13px] text-muted">
            {footer}
          </p>
        )}
      </aside>
    </>
  );
}

type RowProps = Pick<Props, "onSelect" | "onRename" | "onTogglePin" | "onDelete"> & {
  c: Conversation;
  active: boolean;
};

function Row({ c, active, onSelect, onRename, onTogglePin, onDelete }: RowProps) {
  const [mode, setMode] = useState<"idle" | "menu" | "rename" | "confirm">("idle");
  const [menuPos, setMenuPos] = useState<CSSProperties>({});
  const rowRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef(false);
  const refocusRef = useRef(false);

  // Back to the row after a keyboard-driven rename/confirm, right after it renders again.
  useEffect(() => {
    if (mode === "idle" && refocusRef.current) {
      refocusRef.current = false;
      rowRef.current?.focus();
    }
  }, [mode]);

  const finish = (refocus: boolean) => {
    refocusRef.current = refocus;
    setMode("idle");
  };

  const commitRename = (value: string, refocus: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const t = value.replace(/\s+/g, " ").trim();
    if (t && t !== c.title) onRename(c.id, t); // empty reverts to the previous title
    finish(refocus);
  };

  if (mode === "rename") {
    return (
      <li className="py-0.5">
        <input
          autoFocus
          defaultValue={c.title}
          dir="auto"
          maxLength={80}
          aria-label="שם השיחה"
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename(e.currentTarget.value, true);
            } else if (e.key === "Escape") {
              e.preventDefault(); // keep the drawer open
              doneRef.current = true;
              finish(true);
            }
          }}
          onBlur={(e) => commitRename(e.currentTarget.value, false)}
          className="h-10 w-full rounded-xl border border-accent bg-surface px-3 text-base outline-none ring-4 ring-accent/15"
        />
      </li>
    );
  }

  if (mode === "confirm") {
    return (
      <li
        className="fade-in my-1 rounded-xl bg-bubble p-3"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            finish(true);
          }
        }}
      >
        <p className="mb-2.5 text-[15px] leading-snug">
          למחוק את השיחה{" "}
          <bdi className="font-medium">״{c.title}״</bdi>?
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onDelete(c.id)}
            className="press h-9 rounded-lg bg-danger px-3.5 text-[15px] font-medium text-white transition-transform dark:text-bg"
          >
            מחיקה
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => finish(true)}
            className="press h-9 rounded-lg px-3.5 text-[15px] transition-[background-color,transform] hover:bg-line"
          >
            ביטול
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="fade-in group relative">
      <button
        ref={rowRef}
        type="button"
        onClick={() => onSelect(c.id)}
        aria-current={active ? "true" : undefined}
        className={`flex h-10 w-full items-center rounded-xl ps-3 pe-10 text-start text-[15px] transition-colors ${
          active ? "bg-bubble font-medium" : "hover:bg-bubble/60"
        }`}
      >
        {c.pinned && <Pin size={13} aria-label="נעוצה" className="me-1.5 shrink-0 text-muted" />}
        <span dir="auto" className="title block min-w-0 flex-1 truncate">
          {c.title}
        </span>
      </button>
      <button
        ref={triggerRef}
        type="button"
        aria-label="אפשרויות לשיחה"
        aria-haspopup="menu"
        aria-expanded={mode === "menu"}
        onClick={(e) => {
          if (mode === "menu") return setMode("idle");
          setMenuPos(menuPosition(e.currentTarget));
          setMode("menu");
        }}
        // Always visible on touch; on hover-capable devices it appears on hover/focus.
        className={`absolute inset-y-0 inset-e-1 my-auto flex size-8 items-center justify-center rounded-lg text-muted transition-[opacity,background-color] hover:bg-line hover:text-fg focus-visible:opacity-100 aria-expanded:opacity-100 ${
          active ? "" : "[@media(hover:hover)]:opacity-0 group-hover:opacity-100"
        }`}
      >
        <Ellipsis size={18} aria-hidden />
      </button>
      {mode === "menu" && (
        <RowMenu
          pos={menuPos}
          triggerRef={triggerRef}
          pinned={c.pinned}
          onClose={(refocus) => {
            setMode("idle");
            if (refocus) triggerRef.current?.focus();
          }}
          onAction={(a) => {
            if (a === "pin") {
              onTogglePin(c.id);
              setMode("idle");
            } else {
              doneRef.current = false;
              setMode(a);
            }
          }}
        />
      )}
    </li>
  );
}

type Action = "rename" | "pin" | "confirm";

// Fixed positioning escapes the scrolling list; flips upward near the bottom of the screen.
function menuPosition(anchor: HTMLElement): CSSProperties {
  const r = anchor.getBoundingClientRect();
  const rtl = document.documentElement.dir === "rtl";
  const below = r.bottom + 150 < window.innerHeight;
  return {
    top: below ? r.bottom + 4 : undefined,
    bottom: below ? undefined : window.innerHeight - r.top + 4,
    insetInlineEnd: rtl ? r.left : window.innerWidth - r.right,
  };
}

function RowMenu({
  pos,
  triggerRef,
  pinned,
  onClose,
  onAction,
}: {
  pos: CSSProperties;
  triggerRef: RefObject<HTMLButtonElement | null>;
  pinned: boolean;
  onClose: (refocus: boolean) => void;
  onAction: (a: Action) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !triggerRef.current?.contains(t)) closeRef.current(false);
    };
    const away = () => closeRef.current(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", away);
    document.addEventListener("scroll", away, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", away);
      document.removeEventListener("scroll", away, true);
    };
  }, [triggerRef]);

  const onKeyDown = (e: KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
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
      e.preventDefault(); // close the menu, not the drawer
      onClose(true);
    } else if (e.key === "Tab") onClose(false);
  };

  const item =
    "flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-start text-[15px] outline-none transition-colors hover:bg-bubble focus-visible:bg-bubble";

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="אפשרויות לשיחה"
      onKeyDown={onKeyDown}
      style={pos}
      className="fade-in fixed z-50 w-44 rounded-xl border border-line bg-surface p-1 shadow-lg"
    >
      <button type="button" role="menuitem" className={item} onClick={() => onAction("rename")}>
        <Pencil size={16} aria-hidden className="text-muted" />
        שינוי שם
      </button>
      <button type="button" role="menuitem" className={item} onClick={() => onAction("pin")}>
        {pinned ? (
          <PinOff size={16} aria-hidden className="text-muted" />
        ) : (
          <Pin size={16} aria-hidden className="text-muted" />
        )}
        {pinned ? "ביטול נעיצה" : "נעיצה"}
      </button>
      <button type="button" role="menuitem" className={`${item} text-danger`} onClick={() => onAction("confirm")}>
        <Trash2 size={16} aria-hidden />
        מחיקה
      </button>
    </div>
  );
}
