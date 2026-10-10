"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Play, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { useVideoBlobUrl } from "@/hooks/useVideoBlobUrl";
import { CHROME_SURFACE, LIGHTBOX_BUTTON } from "./chromeStyles";
import { cn } from "./nodes/ui/cn";

/**
 * The full-screen media viewer: one component behind the recent-generations
 * drop-down and the output gallery node. It owns the stage, the filmstrip,
 * previous/next, the keys and the motion; a host hands it the items and the
 * actions that make sense there, and the rail shows whatever it is given.
 */

export interface MediaViewerItem {
  id: string;
  src: string;
  kind: "image" | "video";
  /** A poster frame for the strip; a video without one gets a plain tile. */
  thumb?: string;
  /** The rail's heading: the prompt, or "Image 3". */
  title?: string;
  /** Rows under "Details", in order. */
  details?: [string, string][];
}

export interface MediaViewerAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  tone?: "primary" | "default" | "danger" | "success";
  /** A key that fires it while the viewer is open: "Enter", "d". */
  shortcut?: string;
  disabled?: boolean;
  /** A toggle, and whether it is on (outlined in the selection colour): "Add to chat" once added. */
  pressed?: boolean;
}

export interface MediaViewerProps {
  open: boolean;
  items: MediaViewerItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  actions: MediaViewerAction[];
  /** The rail's last row, e.g. a link to Assets. */
  footer?: ReactNode;
  /** Accessible name of the dialog. */
  label: string;
}

/** The strip is a dock: the active tile is large, its neighbours a step up from the rest. */
export const STRIP_ACTIVE = 72;
export const STRIP_NEAR = 52;
export const STRIP_FAR = 40;
const STRIP_GAP = 4;
/** How long the outgoing image is kept for its exit animation once the swap starts. */
const LEAVE_MS = 300;
/** The swap starts when the incoming media has loaded, or after this, whichever is first. */
const READY_FALLBACK_MS = 400;

export function stripTileSize(index: number, active: number): number {
  if (index === active) return STRIP_ACTIVE;
  return Math.abs(index - active) === 1 ? STRIP_NEAR : STRIP_FAR;
}

/**
 * Offset that keeps the active tile under the stage's middle: the strip's
 * track is centred, so shift it by the distance from its centre to the tile's.
 */
export function stripShift(count: number, active: number): number {
  let x = 0;
  let centre = 0;
  for (let i = 0; i < count; i++) {
    const size = stripTileSize(i, active);
    if (i === active) centre = x + size / 2;
    x += size + STRIP_GAP;
  }
  const total = Math.max(0, x - STRIP_GAP);
  return Math.round(total / 2 - centre);
}

const EASE = "cubic-bezier(0.2,0,0,1)";

const ACTION_TONE: Record<NonNullable<MediaViewerAction["tone"]>, string> = {
  primary: "bg-neutral-200 text-neutral-900 hover:bg-[#ededed]",
  success: "bg-emerald-400 text-neutral-900",
  default: "border border-white/12 bg-white/[0.03] text-neutral-200 hover:border-neutral-500 hover:bg-white/7",
  danger: "border border-red-500/35 bg-white/[0.03] text-red-400 hover:bg-red-500/10",
};

function StageVideo({ src, className, onReady }: { src: string; className: string; onReady?: () => void }) {
  const blobUrl = useVideoBlobUrl(src);
  return <video src={blobUrl ?? undefined} className={className} controls autoPlay playsInline onLoadedData={onReady} />;
}

/**
 * One layer of the stage. The same element serves the item while it is
 * current and then while it leaves, so the browser never decodes it twice;
 * `onReady` says when an incoming image has loaded and the swap can start.
 */
function StageMedia({ item, className, hidden, onReady }: { item: MediaViewerItem; className?: string; hidden?: boolean; onReady?: () => void }) {
  const base = cn("absolute inset-0 m-auto max-h-full max-w-full rounded-md object-contain", className);
  if (item.kind === "video") {
    // An outgoing video is a still: a second decoder for a quarter second is not worth it.
    return hidden ? (
      <div aria-hidden="true" className={cn(base, "h-full w-full bg-neutral-900")} />
    ) : (
      <StageVideo src={item.src} className={base} onReady={onReady} />
    );
  }
  return (
    <img
      src={item.src}
      alt={hidden ? "" : item.title ?? ""}
      aria-hidden={hidden || undefined}
      className={base}
      draggable={false}
      onLoad={onReady}
      ref={(img) => {
        // Already decoded (a cached src): there is nothing to wait for.
        if (img && img.complete && img.naturalWidth > 0) onReady?.();
      }}
    />
  );
}

/**
 * The heading, four lines at rest. A longer one (a prompt) gets "Show full
 * prompt", which opens the rest in place, scrolling inside the rail when it
 * would push the actions off. Keyed by item, so the next one starts closed.
 */
function RailTitle({ item }: { item: MediaViewerItem }) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const textId = useId();
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text || expanded) return;
    const measure = () => setClamped(text.scrollHeight > text.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    return () => observer.disconnect();
  }, [item.title, expanded]);
  if (!item.title) return null;
  return (
    <div className="flex min-h-0 flex-col items-start gap-1.5">
      <p
        ref={textRef}
        id={textId}
        className={cn(
          "w-full select-text text-sm font-medium leading-5 tracking-[-0.01em] text-neutral-100",
          expanded ? "min-h-0 overflow-y-auto overscroll-contain whitespace-pre-wrap pr-1" : "line-clamp-4",
        )}
      >
        {item.title}
      </p>
      {(clamped || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => setExpanded((open) => !open)}
          className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 -ml-1.5 text-[11px] font-medium text-neutral-400 transition-colors duration-[120ms] hover:bg-white/7 hover:text-white"
        >
          {expanded ? "Show less" : "Show full prompt"}
          <ChevronDown size={13} strokeWidth={2} className={cn("transition-transform duration-[120ms]", expanded && "rotate-180")} />
        </button>
      )}
    </div>
  );
}

function RailDetails({ item }: { item: MediaViewerItem }) {
  if (!item.details || item.details.length === 0) return null;
  return (
    <div className="flex shrink-0 flex-col gap-4">
      <div className="h-px bg-white/8" />
      <dl className="flex flex-col gap-2">
        <span className="text-[10px] uppercase tracking-[0.06em] text-neutral-500">Details</span>
        {item.details.map(([name, value]) => (
          <div key={name} className="flex justify-between gap-3 text-[11px] leading-[14px]">
            <dt className="text-neutral-500">{name}</dt>
            <dd className="select-text text-right text-neutral-300">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

interface StageState {
  current: MediaViewerItem | undefined;
  /** The item on its way out, kept for the crossfade. */
  leaving: MediaViewerItem | null;
  dir: 1 | -1;
  /** The incoming media has loaded, so both layers may move. */
  ready: boolean;
}

export function MediaViewer({ open, items, index, onIndexChange, onClose, actions, footer, label }: MediaViewerProps) {
  const count = items.length;
  const current = items[index];
  const [stage, setStage] = useState<StageState>({ current, leaving: null, dir: 1, ready: true });
  const shownIndex = useRef(index);
  // Derived during render, so the old layer is never dropped for a frame before the swap is set up.
  if (stage.current?.id !== current?.id) {
    const dir: 1 | -1 = index >= shownIndex.current ? 1 : -1;
    setStage({ current, leaving: open && stage.current && current ? stage.current : null, dir, ready: !open || !stage.current });
  }
  shownIndex.current = index;
  const { leaving, dir, ready } = stage;

  const markReady = useCallback(() => setStage((s) => (s.ready ? s : { ...s, ready: true })), []);
  const clearLeaving = useCallback(() => setStage((s) => (s.leaving ? { ...s, leaving: null } : s)), []);

  // A source that never loads (or a video that starts late) must not hold the swap up.
  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(markReady, READY_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [ready, markReady]);
  // The exit animation's end normally clears the old layer; this covers a skipped animation.
  useEffect(() => {
    if (!leaving || !ready) return;
    const timer = window.setTimeout(clearLeaving, LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, ready, clearLeaving]);

  const go = useCallback(
    (next: number) => {
      if (next < 0 || next >= count || next === index) return;
      onIndexChange(next);
    },
    [count, index, onIndexChange],
  );

  // Keys: arrows step, the actions' own shortcuts fire them. Escape is the dialog's.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(index - 1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(index + 1);
        return;
      }
      const action = actions.find((a) => a.shortcut && !a.disabled && a.shortcut.toLowerCase() === event.key.toLowerCase());
      if (action) {
        event.preventDefault();
        action.onClick();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, index, go, actions]);

  if (!open || !current) return null;

  const hasPrev = index > 0;
  const hasNext = index < count - 1;
  const arrow = (side: "prev" | "next") => (
    <button
      type="button"
      aria-label={side === "prev" ? "Previous" : "Next"}
      disabled={side === "prev" ? !hasPrev : !hasNext}
      onClick={() => go(side === "prev" ? index - 1 : index + 1)}
      className={cn(
        "absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full enabled:cursor-pointer disabled:opacity-0",
        LIGHTBOX_BUTTON,
        side === "prev" ? "left-3" : "right-3",
      )}
    >
      {side === "prev" ? <ChevronLeft size={20} strokeWidth={2} /> : <ChevronRight size={20} strokeWidth={2} />}
    </button>
  );

  return (
    <Dialog open onClose={onClose} variant="lightbox" portal label={label} className="flex h-full w-full items-stretch gap-6" stopWheel>
      <div className="flex min-w-0 flex-1 flex-col items-center gap-3">
        {/* Stage */}
        <div data-testid="media-viewer-stage" className="relative min-h-0 w-full flex-1 overflow-hidden">
          {/* Keyed by item, so the outgoing layer keeps its element (and decoded image) as it moves to the back. */}
          {leaving && (
            <div
              key={leaving.id}
              data-testid="media-viewer-leaving"
              className={cn("pointer-events-none absolute inset-0", ready && (dir > 0 ? "animate-viewer-out-left" : "animate-viewer-out-right"))}
              onAnimationEnd={clearLeaving}
            >
              <StageMedia item={leaving} hidden />
            </div>
          )}
          <div
            key={current.id}
            data-testid="media-viewer-current"
            className={cn("absolute inset-0", leaving && (ready ? (dir > 0 ? "animate-viewer-in-right" : "animate-viewer-in-left") : "opacity-0"))}
          >
            <StageMedia item={current} onReady={leaving && !ready ? markReady : undefined} />
          </div>
          {arrow("prev")}
          {arrow("next")}
        </div>

        {/* Strip */}
        <div className="flex h-[84px] w-full shrink-0 items-center justify-center overflow-hidden" data-testid="media-viewer-strip">
          <div
            className="flex items-center gap-1 transition-transform duration-[240ms] motion-reduce:transition-none"
            style={{ transform: `translateX(${stripShift(count, index)}px)`, transitionTimingFunction: EASE }}
          >
            {items.map((item, i) => {
              const size = stripTileSize(i, index);
              const active = i === index;
              const near = Math.abs(i - index) === 1;
              const tile = item.kind === "video" ? item.thumb : item.src;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-label={item.title ?? `${item.kind === "video" ? "Video" : "Image"} ${i + 1}`}
                  aria-current={active ? "true" : undefined}
                  onClick={() => go(i)}
                  style={{ width: size, height: size, transitionTimingFunction: EASE }}
                  className={cn(
                    "relative shrink-0 cursor-pointer overflow-hidden bg-well transition-[width,height,opacity,border-radius,box-shadow] duration-[240ms] motion-reduce:transition-none",
                    active ? "rounded-[10px] opacity-100 shadow-[inset_0_0_0_2px_#3b82f6]" : "rounded-lg shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:opacity-100",
                    !active && (near ? "opacity-85" : "opacity-60"),
                  )}
                >
                  {tile ? <img src={tile} alt="" className="pointer-events-none h-full w-full object-cover" draggable={false} /> : null}
                  {item.kind === "video" && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
                      <Play size={active ? 20 : 14} strokeWidth={2} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Rail */}
      {/* Only the heading gives way when the rail runs out of height: a whole prompt scrolls, the rest stays put. */}
      <aside className={cn(CHROME_SURFACE, "flex w-80 shrink-0 flex-col gap-4 rounded-xl p-4")} data-testid="media-viewer-rail">
        <div className="flex shrink-0 items-center justify-between">
          <span className="font-mono text-[11px] tabular-nums text-neutral-400">
            {index + 1} of {count}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="Previous"
              disabled={!hasPrev}
              onClick={() => go(index - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-white/4 text-neutral-200 transition-colors enabled:cursor-pointer hover:bg-white/8 disabled:opacity-30 disabled:hover:bg-white/4"
            >
              <ChevronLeft size={16} strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label="Next"
              disabled={!hasNext}
              onClick={() => go(index + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-white/4 text-neutral-200 transition-colors enabled:cursor-pointer hover:bg-white/8 disabled:opacity-30 disabled:hover:bg-white/4"
            >
              <ChevronRight size={16} strokeWidth={2} />
            </button>
            {/* In the rail, not hanging off the top corner: up there it sat inside the
                desktop window's drag strip, where a click moved the window instead. */}
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="ml-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-white/4 text-neutral-200 transition-colors hover:bg-white/8"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* The rail swaps outright: fading text read badly against the image's crossfade. */}
        <RailTitle key={current.id} item={current} />
        <div className="flex shrink-0 flex-col gap-1.5">
          {actions.map((action, index) => {
            const Icon = action.icon;
            return (
              <button
                // By place: a toggle's label changes with it, and the button must keep its focus.
                key={index}
                type="button"
                disabled={action.disabled}
                aria-pressed={action.pressed}
                onClick={action.onClick}
                className={cn(
                  "flex h-9 w-full items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors duration-[160ms] enabled:cursor-pointer disabled:opacity-40",
                  ACTION_TONE[action.tone ?? "default"],
                  action.pressed && "border-selection text-white hover:border-selection",
                )}
              >
                <Icon size={15} strokeWidth={2} />
                {action.label}
              </button>
            );
          })}
        </div>
        <RailDetails item={current} />

        <div className="flex-1" />
        {footer && <div className="flex shrink-0 flex-col">{footer}</div>}
      </aside>
    </Dialog>
  );
}
