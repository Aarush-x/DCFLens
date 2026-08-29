"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("DCFLens page boundary", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <main className="state-page">
      <div className="state-page__inner">
        <p className="eyebrow">Research note interrupted</p>
        <h1>We could not prepare this view.</h1>
        <p>The failure has been recorded without exposing provider credentials or private request details. Try the view again.</p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
