const LOCAL_DEVELOPMENT_API_URL = "http://localhost:8000";

export function normalizeApiUrl(rawValue: string): string {
  const value = rawValue.trim();
  if (!value) {
    throw new Error("NEXT_PUBLIC_API_URL cannot be empty when configured");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("NEXT_PUBLIC_API_URL must be a valid absolute URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_API_URL must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("NEXT_PUBLIC_API_URL must not contain credentials");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("NEXT_PUBLIC_API_URL must not contain a query string or fragment");
  }

  return parsed.toString().replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configuredUrl) {
    return normalizeApiUrl(configuredUrl);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_API_URL is required for production builds and deployments",
    );
  }

  return LOCAL_DEVELOPMENT_API_URL;
}
