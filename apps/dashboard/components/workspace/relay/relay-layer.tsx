"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useSystemStatus } from "../sky/system-status";
import { WorkspaceAsk, useAskPhase } from "../workspace-ask";
import "./relay.css";

type Height = "rest" | "answer" | "thread";
const PULL_PX = 48;
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Keeps the composer above a phone keyboard, which covers the page without resizing it. Only runs while Relay is open. */
function followViewport(root: HTMLElement, onWidthChange: () => void): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  let frame = 0;
  let width = window.innerWidth;
  // A rotation can rewrap the status strip, so the sheet measures it again.
  const onResize = () => { if (window.innerWidth !== width) { width = window.innerWidth; onWidthChange(); } };
  const apply = () => {
    frame = 0;
    if (viewport.scale > 1.01) return; // A pinch zoom isn't a keyboard.
    root.style.setProperty("--relay-vvh", `${viewport.height}px`);
    root.style.setProperty("--relay-kb", `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
  };
  const queue = () => { if (!frame) frame = requestAnimationFrame(apply); };
  apply();
  viewport.addEventListener("resize", queue);
  viewport.addEventListener("scroll", queue);
  window.addEventListener("resize", onResize);
  return () => {
    cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", queue);
    viewport.removeEventListener("scroll", queue);
    window.removeEventListener("resize", onResize);
    root.style.removeProperty("--relay-vvh");
    root.style.removeProperty("--relay-kb");
  };
}

function focusableIn(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("a[href],button:not(:disabled),textarea:not(:disabled),input:not(:disabled),summary")]
    .filter(el => !el.closest("[inert]") && (el.checkVisibility ? el.checkVisibility() : el.getClientRects().length > 0));
}

/** The status strip scrolls away with the page, so an open Relay keeps the reading on screen itself. */
function StatusLine() {
  const sky = useSystemStatus();
  return <p className="relay-status"><span className={`workspace-status-dot sky-${sky.id}`} aria-hidden="true" />{sky.label}{sky.production ? ` · ${sky.production}` : ""}</p>;
}

/**
 * Relay, near the operator, over every Workspace view. The field is always the same element, so a tap on the capsule
 * reaches a real text field and the phone raises its keyboard. Open Relay is modal: the View behind it is inert and a
 * tap outside only puts Relay down. Everything that moves is transform or opacity. Nothing here reads data or waits for it.
 */
export function RelayLayer({ children }: { children: ReactNode }) {
  const [height, setHeight] = useState<Height>("rest");
  const [statusLine, setStatusLine] = useState(false);
  const open = height !== "rest";
  const phase = useAskPhase();
  const root = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const chevron = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<Element | null>(null);
  const wasOpen = useRef(false);
  const heightNow = useRef<Height>(height);
  useBeforePaint(() => { heightNow.current = height; }, [height]);

  /** Measured when it opens, so the sheet stops just under the strip and the View shrinks around what's on screen. */
  const prepareToOpen = useCallback(() => {
    const element = root.current;
    if (!element) return;
    const headerBottom = document.querySelector(".workspace-header")?.getBoundingClientRect().bottom ?? 0;
    setStatusLine(headerBottom < 44);
    element.style.setProperty("--relay-strip", `${Math.ceil(Math.max(headerBottom, 44)) + 8}px`);
    const main = element.querySelector(".relay-view > main");
    if (main) element.style.setProperty("--relay-origin-y", `${Math.round(window.innerHeight / 2 - main.getBoundingClientRect().top)}px`);
  }, []);

  const rise = useCallback((to: Exclude<Height, "rest">) => {
    if (heightNow.current === "rest") prepareToOpen();
    setHeight(to);
  }, [prepareToOpen]);

  const onFieldFocus = useCallback((from: Element | null) => {
    if (heightNow.current !== "rest") return;
    if (from && !returnTo.current) returnTo.current = from;
    rise("answer");
  }, [rise]);

  // A receipt link is the operator asking to see that receipt, so it arrives open, without raising a keyboard.
  useEffect(() => {
    if (new URL(window.location.href).searchParams.get("receipt")) rise("answer");
  }, [rise]);

  useEffect(() => {
    if (!open || !root.current) return;
    return followViewport(root.current, prepareToOpen);
  }, [open, prepareToOpen]);

  // Focus follows Relay down, after the View stops being inert.
  useBeforePaint(() => {
    if (open) { wasOpen.current = true; return; }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const back = returnTo.current;
    returnTo.current = null;
    const active = document.activeElement;
    const inRelay = active === document.body || (active instanceof Element && Boolean(sheet.current?.contains(active)));
    if (!inRelay) return;
    if (back instanceof HTMLElement && back.isConnected && back !== field.current && !back.closest("[inert]")) back.focus({ preventScroll: true });
    else if (chevron.current) chevron.current.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      // A native modal, like an open Artifact, owns the keyboard until it closes.
      if (document.querySelector("dialog:modal")) return;
      const now = heightNow.current;
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const target = event.target;
        if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
        event.preventDefault();
        returnTo.current = target instanceof HTMLElement && target !== document.body ? target : null;
        field.current?.focus();
        return;
      }
      if (now === "rest") return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (now === "thread") { setHeight("answer"); field.current?.focus({ preventScroll: true }); }
        else setHeight("rest");
        return;
      }
      if (event.key === "Tab" && sheet.current) {
        const stops = focusableIn(sheet.current);
        if (!stops.length) return;
        const active = document.activeElement;
        const first = stops[0], last = stops[stops.length - 1];
        const outside = !(active instanceof Element && sheet.current.contains(active));
        if (event.shiftKey && (active === first || outside)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (active === last || outside)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // A receipt link opens Relay with nothing focused, so keyboard and screen reader users start inside it.
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (active === document.body || active === null) sheet.current?.focus({ preventScroll: true });
  }, [open]);

  // A mouse wheel over the scrim shouldn't scroll the View behind it.
  const scrim = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scrim.current;
    if (!element) return;
    const stop = (event: WheelEvent) => event.preventDefault();
    element.addEventListener("wheel", stop, { passive: false });
    return () => element.removeEventListener("wheel", stop);
  }, []);

  /** Pulling the grip follows the finger with a transform only, then settles on the next height or back where it was. */
  const pull = useRef<{ id: number; y: number } | null>(null);
  const onPullStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !(event.target instanceof Element) || !event.target.closest(".relay-head") || event.target.closest("button")) return;
    pull.current = { id: event.pointerId, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    sheet.current?.setAttribute("data-pulling", "");
  };
  const onPullMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pull.current?.id !== event.pointerId) return;
    sheet.current?.style.setProperty("--relay-pull", `${event.clientY - pull.current.y}px`);
  };
  const onPullEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pull.current?.id !== event.pointerId) return;
    const moved = event.clientY - pull.current.y;
    pull.current = null;
    sheet.current?.removeAttribute("data-pulling");
    sheet.current?.style.removeProperty("--relay-pull");
    if (moved <= -PULL_PX) setHeight("thread");
    else if (moved >= PULL_PX) setHeight(heightNow.current === "thread" ? "answer" : "rest");
  };

  const waiting = phase === "sending" ? "Your Ask is still sending" : phase === "uncertain" ? "Your last Ask's outcome is unknown" : null;
  return <div ref={root} className="relay-root">
    <div className="relay-view" inert={open} data-receded={open ? "" : undefined}>{children}</div>
    <div ref={scrim} className="relay-scrim" data-open={open ? "" : undefined} aria-hidden="true" onClick={() => setHeight("rest")} />
    {open && statusLine && <StatusLine />}
    <div ref={sheet} className="relay" data-height={height} tabIndex={-1} role={open ? "dialog" : "region"} aria-modal={open ? true : undefined} aria-label="Relay"
      onPointerDown={onPullStart} onPointerMove={onPullMove} onPointerUp={onPullEnd} onPointerCancel={onPullEnd}>
      <div className="relay-surface" />
      <WorkspaceAsk open={open} thread={height === "thread"} field={field} onFieldFocus={onFieldFocus}
        head={<span className="relay-head-actions">
          <button type="button" aria-expanded={height === "thread"} onClick={() => setHeight(height === "thread" ? "answer" : "thread")}>{height === "thread" ? "Show less" : "Whole thread"}</button>
          <button type="button" onClick={() => setHeight("rest")}>Put down</button>
        </span>}
        fieldControl={<button ref={chevron} type="button" className="relay-chevron" inert={open} aria-label={waiting ? `Show the whole thread. ${waiting}.` : "Show the whole thread"} data-phase={phase ?? undefined}
          onClick={() => { returnTo.current = chevron.current; rise("thread"); }}><span aria-hidden="true">⌃</span></button>} />
    </div>
  </div>;
}
