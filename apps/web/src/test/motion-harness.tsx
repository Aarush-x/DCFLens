import { StrictMode, type ReactNode } from "react";
import { act, render, type RenderResult } from "@testing-library/react";

import { REDUCED_MOTION_QUERY } from "@/lib/reduced-motion";

type MediaListener = () => void;

export type MatchMediaStub = {
  /** Flips the preference and notifies subscribers, as the OS setting would. */
  set: (reduce: boolean) => void;
  /** Number of listeners still attached — zero after a clean teardown. */
  listenerCount: () => number;
  restore: () => void;
};

/**
 * jsdom has no `matchMedia`, so every reduced-motion test installs its own.
 * Returning the listener count lets a test prove the subscription was removed
 * rather than merely assuming `useSyncExternalStore` did the right thing.
 */
export function installMatchMedia(reduce: boolean): MatchMediaStub {
  const listeners = new Set<MediaListener>();
  let matches = reduce;
  const original = window.matchMedia;

  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return query === REDUCED_MOTION_QUERY ? matches : false;
    },
    addEventListener: (_type: string, listener: MediaListener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: MediaListener) => {
      listeners.delete(listener);
    },
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  return {
    set(next: boolean) {
      matches = next;
      act(() => {
        for (const listener of [...listeners]) {
          listener();
        }
      });
    },
    listenerCount: () => listeners.size,
    restore() {
      window.matchMedia = original;
    },
  };
}

/**
 * Mounts under `StrictMode`, so every effect runs and tears down twice. The
 * returned `rerender` keeps the wrapper in place — re-rendering without it
 * would swap the root element type and remount the whole tree, which would
 * quietly turn an update test into a mount test.
 */
export function renderStrict(ui: ReactNode): RenderResult {
  const result = render(<StrictMode>{ui}</StrictMode>);
  return {
    ...result,
    rerender: (next: ReactNode) => result.rerender(<StrictMode>{next}</StrictMode>),
  };
}
