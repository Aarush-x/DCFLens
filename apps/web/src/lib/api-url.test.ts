import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the local development default outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");

    expect(getApiBaseUrl()).toBe("http://localhost:8000");
  });

  it("requires an explicit production URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");

    expect(() => getApiBaseUrl()).toThrow(
      "NEXT_PUBLIC_API_URL is required for production",
    );
  });

  it("uses the configured URL in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://dcflens-api.example.com/");

    expect(getApiBaseUrl()).toBe("https://dcflens-api.example.com");
  });
});
