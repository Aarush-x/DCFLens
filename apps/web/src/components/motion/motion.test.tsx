import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { installMatchMedia, renderStrict, type MatchMediaStub } from "@/test/motion-harness";

import { AssemblySequence, orderAssemblyStages } from "./assembly-sequence";
import { DisclosureMotion } from "./disclosure-motion";
import { EvidenceTrace } from "./evidence-trace";
import { FigureTransition } from "./figure-transition";
import { gsap } from "./gsap";
import { Reveal } from "./reveal";

let media: MatchMediaStub | null = null;

function withReducedMotion(reduce: boolean): MatchMediaStub {
  media = installMatchMedia(reduce);
  return media;
}

afterEach(() => {
  media?.restore();
  media = null;
  gsap.globalTimeline.clear();
});

/** Every inline property GSAP could have written, across every element. */
function inlineStyles(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>("*")]
    .map((element) => element.getAttribute("style") ?? "")
    .filter((style) => style !== "");
}

function tweenCount(container: HTMLElement, selector: string): number[] {
  return tweensOf([...container.querySelectorAll<HTMLElement>(selector)]);
}

/**
 * Counted from held references rather than from a query, because unmounting
 * empties the container: querying it afterwards finds nothing and would pass
 * whether or not the tweens were actually killed.
 */
function tweensOf(elements: HTMLElement[]): number[] {
  return elements.map((element) => gsap.getTweensOf(element).length);
}

describe("Reveal under prefers-reduced-motion", () => {
  it("creates no animation and writes no inline style", () => {
    withReducedMotion(true);
    const { container } = renderStrict(
      <Reveal immediate>
        <p>Apple looks fairly priced</p>
        <p>Second</p>
      </Reveal>,
    );

    expect(inlineStyles(container)).toEqual([]);
    expect(tweenCount(container, "p")).toEqual([0, 0]);
  });

  it("leaves the content readable rather than hidden at opacity zero", () => {
    withReducedMotion(true);
    renderStrict(
      <Reveal immediate>
        <p>Apple looks fairly priced</p>
      </Reveal>,
    );

    const paragraph = screen.getByText("Apple looks fairly priced");
    expect(paragraph.style.opacity).toBe("");
    expect(window.getComputedStyle(paragraph).opacity).toBe("1");
  });

  it("turning the preference on mid-session tears the animation down cleanly", () => {
    const stub = withReducedMotion(false);
    const { container } = renderStrict(
      <Reveal immediate>
        <p>One</p>
        <p>Two</p>
      </Reveal>,
    );
    expect(tweenCount(container, "p")).toEqual([1, 1]);

    stub.set(true);

    expect(tweenCount(container, "p")).toEqual([0, 0]);
    expect(inlineStyles(container)).toEqual([]);
  });
});

describe("Reveal cleanup in Strict Mode", () => {
  it("builds exactly one tween per target despite the double effect", () => {
    withReducedMotion(false);
    const { container } = renderStrict(
      <Reveal immediate>
        <p>One</p>
        <p>Two</p>
        <p>Three</p>
      </Reveal>,
    );

    expect(tweenCount(container, "p")).toEqual([1, 1, 1]);
  });

  it("reverts every inline style and kills every tween on unmount", () => {
    withReducedMotion(false);
    const { container, unmount } = renderStrict(
      <Reveal immediate>
        <p>One</p>
        <p>Two</p>
      </Reveal>,
    );
    const paragraphs = [...container.querySelectorAll<HTMLElement>("p")];
    expect(inlineStyles(container).length).toBe(2);
    expect(tweensOf(paragraphs)).toEqual([1, 1]);

    unmount();

    expect(paragraphs.map((element) => element.getAttribute("style") ?? "")).toEqual(["", ""]);
    expect(tweensOf(paragraphs)).toEqual([0, 0]);
  });

  it("leaves no media-query listener behind", () => {
    const stub = withReducedMotion(false);
    const { unmount } = renderStrict(
      <Reveal immediate>
        <p>One</p>
      </Reveal>,
    );

    unmount();
    expect(stub.listenerCount()).toBe(0);
  });
});

describe("Reveal and keyboard access", () => {
  it("settles immediately when a reader tabs in, rather than making them wait", () => {
    withReducedMotion(false);
    renderStrict(
      <Reveal immediate>
        <p>One</p>
        <p>
          <a href="#know-why">Know why</a>
        </p>
      </Reveal>,
    );

    const link = screen.getByRole("link", { name: "Know why" });
    const paragraph = link.closest("p") as HTMLElement;
    expect(Number(paragraph.style.opacity)).toBeLessThan(1);

    act(() => {
      fireEvent.focusIn(link);
    });

    expect(Number(paragraph.style.opacity || "1")).toBe(1);
  });
});

describe("orderAssemblyStages", () => {
  it("puts the stages into pipeline order regardless of document order", () => {
    const ordered = orderAssemblyStages([
      { step: "valuation", element: "v" },
      { step: "ticker", element: "t" },
      { step: "checklist", element: "c" },
      { step: "facts", element: "f" },
      { step: "adjustment", element: "a" },
    ]);

    expect(ordered.map((stage) => stage.step)).toEqual([
      "ticker",
      "facts",
      "checklist",
      "adjustment",
      "valuation",
    ]);
  });

  it("ignores stages that are not part of the pipeline", () => {
    const ordered = orderAssemblyStages([
      { step: "ticker", element: "t" },
      { step: "sidebar", element: "x" },
    ]);

    expect(ordered.map((stage) => stage.step)).toEqual(["ticker"]);
  });

  it("tolerates a page where only some stages are present", () => {
    const ordered = orderAssemblyStages([
      { step: "valuation", element: "v" },
      { step: "facts", element: "f" },
    ]);

    expect(ordered.map((stage) => stage.step)).toEqual(["facts", "valuation"]);
  });
});

describe("AssemblySequence under prefers-reduced-motion", () => {
  it("leaves every stage exactly as rendered", () => {
    withReducedMotion(true);
    const { container } = renderStrict(
      <AssemblySequence>
        <p data-assembly-step="ticker">AAPL</p>
        <p data-assembly-step="valuation">$184.80</p>
      </AssemblySequence>,
    );

    expect(inlineStyles(container)).toEqual([]);
    expect(tweenCount(container, "[data-assembly-step]")).toEqual([0, 0]);
  });
});

describe("EvidenceTrace under prefers-reduced-motion", () => {
  it("draws the connector at rest, with no tween on it", () => {
    withReducedMotion(true);
    const { container } = renderStrict(
      <EvidenceTrace>
        <ul className="citation">
          <span className="citation__trace" aria-hidden="true" />
          <li>10-K · Revenues · FY2025</li>
        </ul>
      </EvidenceTrace>,
    );

    expect(tweenCount(container, ".citation__trace")).toEqual([0]);
    expect(inlineStyles(container)).toEqual([]);
  });
});

function DisclosureFixture() {
  return (
    <DisclosureMotion>
      <details className="disclosure">
        <summary className="disclosure__summary">
          <h3>Starting assumptions</h3>
        </summary>
        <div className="disclosure__body">
          <p>Growth of 6.0% for years one to five.</p>
          <a href="#evidence">Open direct filing evidence</a>
        </div>
      </details>
    </DisclosureMotion>
  );
}

describe("DisclosureMotion", () => {
  function openDetails(container: HTMLElement): HTMLDetailsElement {
    const details = container.querySelector("details") as HTMLDetailsElement;
    act(() => {
      details.open = true;
      // jsdom does not fire `toggle` itself when `open` is set from script.
      fireEvent(details, new Event("toggle"));
    });
    return details;
  }

  it("animates the panel open when the summary is on screen", () => {
    withReducedMotion(false);
    const { container } = renderStrict(<DisclosureFixture />);

    openDetails(container);

    const panel = container.querySelector(".disclosure__body") as HTMLElement;
    expect(gsap.getTweensOf(panel).length).toBe(1);
  });

  it("opens with no animation at all under reduced motion", () => {
    withReducedMotion(true);
    const { container } = renderStrict(<DisclosureFixture />);

    openDetails(container);

    const panel = container.querySelector(".disclosure__body") as HTMLElement;
    expect(gsap.getTweensOf(panel).length).toBe(0);
    expect(inlineStyles(container)).toEqual([]);
  });

  it("does not animate on close, leaving the element's own behaviour untouched", () => {
    withReducedMotion(false);
    const { container } = renderStrict(<DisclosureFixture />);
    const details = openDetails(container);
    const panel = container.querySelector(".disclosure__body") as HTMLElement;
    act(() => {
      gsap.killTweensOf(panel);
      details.open = false;
      fireEvent(details, new Event("toggle"));
    });

    expect(gsap.getTweensOf(panel).length).toBe(0);
  });

  it("registers one handler in Strict Mode, so a panel is never animated twice", () => {
    withReducedMotion(false);
    const { container } = renderStrict(<DisclosureFixture />);

    openDetails(container);

    const panel = container.querySelector(".disclosure__body") as HTMLElement;
    expect(gsap.getTweensOf(panel).length).toBe(1);
  });

  it("removes its toggle listener on unmount", () => {
    withReducedMotion(false);
    const { container, unmount } = renderStrict(<DisclosureFixture />);
    const details = container.querySelector("details") as HTMLDetailsElement;
    const panel = container.querySelector(".disclosure__body") as HTMLElement;

    unmount();

    act(() => {
      details.open = true;
      fireEvent(details, new Event("toggle"));
    });
    expect(gsap.getTweensOf(panel).length).toBe(0);
  });

  it("settles the panel the instant focus enters it, so nothing is focused while invisible", () => {
    withReducedMotion(false);
    const { container } = renderStrict(<DisclosureFixture />);
    openDetails(container);

    const panel = container.querySelector(".disclosure__body") as HTMLElement;
    expect(Number(panel.style.opacity)).toBe(0);

    const link = screen.getByRole("link", { name: "Open direct filing evidence" });
    act(() => {
      fireEvent.focusIn(link);
    });

    // `clearProps` runs at the end of the tween, so an empty style attribute is
    // the panel at its resting state — fully opaque, no offset.
    expect(panel.getAttribute("style") ?? "").toBe("");
  });
});

function FigureFixture({ value }: { value: string }) {
  return (
    <FigureTransition settleOnReveal={false}>
      <dl>
        <dt>What the filings suggest one share is worth</dt>
        <dd className="financial-value">{value}</dd>
      </dl>
    </FigureTransition>
  );
}

describe("FigureTransition", () => {
  it("never renders a value between the old one and the new one", async () => {
    withReducedMotion(false);
    const { container, rerender } = renderStrict(<FigureFixture value="$165.00" />);
    const figure = container.querySelector(".financial-value") as HTMLElement;

    const seen: string[] = [figure.textContent ?? ""];
    const observer = new MutationObserver(() => seen.push(figure.textContent ?? ""));
    observer.observe(figure, { characterData: true, childList: true, subtree: true });

    rerender(<FigureFixture value="$205.00" />);
    await act(async () => {
      await Promise.resolve();
    });
    observer.disconnect();

    // Only ever the two real values. A counted-up figure would leave a trail of
    // numbers no filing supports.
    expect([...new Set(seen)]).toEqual(["$165.00", "$205.00"]);
  });

  it("writes no inline style under reduced motion", () => {
    withReducedMotion(true);
    const { container, rerender } = renderStrict(<FigureFixture value="$165.00" />);
    rerender(<FigureFixture value="$205.00" />);

    expect(inlineStyles(container)).toEqual([]);
  });

  it("disconnects its observer on unmount", () => {
    withReducedMotion(false);
    const { container, unmount } = renderStrict(<FigureFixture value="$165.00" />);
    const figure = container.querySelector(".financial-value") as HTMLElement;

    unmount();

    act(() => {
      figure.textContent = "$205.00";
    });
    expect(gsap.getTweensOf(figure).length).toBe(0);
  });
});
