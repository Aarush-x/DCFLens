"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fixtureTickers } from "@/fixtures/analysis";

export function TickerForm() {
  const router = useRouter();
  const [ticker, setTicker] = useState("AAPL");
  const [message, setMessage] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTicker = ticker.trim().toUpperCase();

    if (!normalizedTicker) {
      setMessage("Enter a ticker symbol to continue.");
      return;
    }
    if (!fixtureTickers.includes(normalizedTicker)) {
      setMessage(
        `${normalizedTicker} is not in this fixture preview. Available: ${fixtureTickers.join(", ")}.`,
      );
      return;
    }

    setMessage(`Opening the ${normalizedTicker} fixture analysis.`);
    router.push(`/analysis/${normalizedTicker}`);
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
      <Button type="submit">Open analysis</Button>
      <p className="form-message" aria-live="polite">
        {message || `Fixture mode · ${fixtureTickers.join(", ")}`}
      </p>
    </form>
  );
}
