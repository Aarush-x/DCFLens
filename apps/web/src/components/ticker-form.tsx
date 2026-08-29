"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TickerForm() {
  const [ticker, setTicker] = useState("AAPL");
  const [message, setMessage] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTicker = ticker.trim().toUpperCase();
    if (!normalizedTicker) {
      setMessage("Enter a ticker symbol to continue.");
    } else if (normalizedTicker !== "AAPL") {
      setMessage(`${normalizedTicker} is not in this static preview. Live analysis will be connected later.`);
    } else {
      setMessage("AAPL fixture loaded above. Live API requests are intentionally disabled.");
    }
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
      <Button type="submit">Review fixture</Button>
      <p className="form-message" aria-live="polite">{message || "Fixture mode · no live provider calls"}</p>
    </form>
  );
}
