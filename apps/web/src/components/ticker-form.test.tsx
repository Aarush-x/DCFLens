import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TickerForm } from "@/components/ticker-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("TickerForm", () => {
  beforeEach(() => push.mockClear());

  it("suppresses duplicate form submissions", () => {
    render(<TickerForm />);
    const button = screen.getByRole("button", { name: "Analyze ticker" });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/analysis/AAPL");
  });
});
