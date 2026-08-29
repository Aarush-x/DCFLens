import { describe, expect, it } from "vitest";

import { getApiBaseUrl, normalizeApiUrl } from "./api-url";

describe("normalizeApiUrl", () => {
  it("normalizes whitespace and trailing slashes", () => {
    expect(normalizeApiUrl(" https://api.example.com/v1/// ")).toBe(
      "https://api.example.com/v1",
    );
  });

  it("rejects credentials and non-HTTP protocols", () => {
    expect(() => normalizeApiUrl("https://user:pass@example.com")).toThrow(
      "must not contain credentials",
    );
    expect(() => normalizeApiUrl("file:///tmp/api")).toThrow(
      "must use http or https",
    );
  });
});

describe("getApiBaseUrl", () => {
  it("uses the local development default outside production", () => {
    expect(getApiBaseUrl({ NODE_ENV: "development" })).toBe(
      "http://localhost:8000",
    );
  });

  it("requires an explicit production URL", () => {
    expect(() => getApiBaseUrl({ NODE_ENV: "production" })).toThrow(
      "NEXT_PUBLIC_API_URL is required for production",
    );
  });

  it("uses the configured URL in production", () => {
    expect(
      getApiBaseUrl({
        NODE_ENV: "production",
        NEXT_PUBLIC_API_URL: "https://dcflens-api.example.com/",
      }),
    ).toBe("https://dcflens-api.example.com");
  });
});
