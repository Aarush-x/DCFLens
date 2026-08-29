"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TickerForm() {
  const router = useRouter();
  const [ticker, setTicker] = useState("AAPL");
  const [message, setMessage] = useState("");
  const submissionInFlight = useRef(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlight.current) {
      return;
    }
    const normalizedTicker = ticker.trim().toUpperCase();

    if (!normalizedTicker) {
      setMessage("Enter a ticker symbol to continue.");
      return;
    }
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalizedTicker)) {
      setMessage("Use up to 10 letters, numbers, periods, or hyphens.");
      return;
    }

    submissionInFlight.current = true;
    setMessage(`Opening the ${normalizedTicker.replaceAll(".", "-")} analysis.`);
    router.push(`/analysis/${encodeURIComponent(normalizedTicker.replaceAll(".", "-"))}`);
  }

  return (
    <form className="ticker-form" onSubmit={handleSubmit} noValidate>
      <Input
        id="ticker"
        label="Public company ticker"
        name="ticker"
        autoCapitalize="characters"
        autoComplete="off"
        maxLength={8}
        onChange={(event) => setTicker(event.target.value.toUpperCase())}
        placeholder="AAPL"
        spellCheck={false}
        value={ticker}
      />
      <Button type="submit">Analyze ticker</Button>
      <p className="form-message" aria-live="polite">
        {message || "Live SEC evidence · deterministic valuation · bounded AI review"}
      </p>
    </form>
  );
}
