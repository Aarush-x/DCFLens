import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * jsdom implements no `matchMedia`, and GSAP calls it while registering
 * ScrollTrigger — before any test body runs. This is the baseline stub; tests
 * that care about the preference install their own over the top of it with
 * `installMatchMedia`.
 */
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/**
 * React Testing Library only unmounts automatically when Vitest globals are
 * enabled, and they are not. Unmounting matters more here than in most suites:
 * every motion test asserts something about teardown.
 */
afterEach(() => {
  cleanup();
});
