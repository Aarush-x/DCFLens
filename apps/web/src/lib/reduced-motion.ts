"use client";

import { useSyncExternalStore } from "react";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * A `MediaQueryList` narrowed to what we use, so the store can be driven by a
 * stub in tests without reaching for a DOM-wide fake.
 */
export type MotionQueryList = {
  matches: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
  /** Safari below 14 and some embedded WebViews only have the legacy pair. */
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
};

function query(): MotionQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY);
}

/**
 * Reads the preference once. Callers inside a GSAP context use this rather than
 * the hook when they need the value at the moment an interaction happens.
 */
export function prefersReducedMotion(): boolean {
  return query()?.matches ?? false;
}

/** Subscribes to changes, handling both the modern and the legacy listener API. */
export function subscribeToReducedMotion(list: MotionQueryList | null, onChange: () => void): () => void {
  if (list === null) {
    return () => {};
  }
  if (typeof list.addEventListener === "function") {
    list.addEventListener("change", onChange);
    return () => list.removeEventListener?.("change", onChange);
  }
  if (typeof list.addListener === "function") {
    list.addListener(onChange);
    return () => list.removeListener?.(onChange);
  }
  return () => {};
}

/**
 * `false` on the server and for the first client snapshot, which is safe
 * because nothing is animated during render — every animation is set up in an
 * effect, by which point this reports the real preference. Changing the system
 * setting mid-session re-runs the animation effects, which tears the old
 * animations down and leaves the page in its resting state.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeToReducedMotion(query(), onChange),
    () => prefersReducedMotion(),
    () => false,
  );
}
