import { describe, expect, it, vi } from "vitest";

import { subscribeToReducedMotion, type MotionQueryList } from "./reduced-motion";

describe("subscribeToReducedMotion", () => {
  it("is a no-op when there is no media query to watch", () => {
    const unsubscribe = subscribeToReducedMotion(null, () => {});
    expect(() => unsubscribe()).not.toThrow();
  });

  it("subscribes and unsubscribes through the modern listener API", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const list: MotionQueryList = { matches: false, addEventListener, removeEventListener };
    const onChange = () => {};

    const unsubscribe = subscribeToReducedMotion(list, onChange);
    expect(addEventListener).toHaveBeenCalledWith("change", onChange);

    unsubscribe();
    expect(removeEventListener).toHaveBeenCalledWith("change", onChange);
  });

  it("falls back to the legacy pair for older Safari and embedded WebViews", () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    const list: MotionQueryList = { matches: true, addListener, removeListener };
    const onChange = () => {};

    const unsubscribe = subscribeToReducedMotion(list, onChange);
    expect(addListener).toHaveBeenCalledWith(onChange);

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(onChange);
  });

  it("does not throw on a query list that supports neither API", () => {
    const unsubscribe = subscribeToReducedMotion({ matches: false }, () => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});
