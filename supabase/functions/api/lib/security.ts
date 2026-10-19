// Security utilities for URL redaction and constant-time string comparison.
// Prevents secret leakage in reverse proxy logs, referrers, and diagnostic telemetry.

export const SENSITIVE_QUERY_PARAMS = new Set([
  "token",
  "notification_token",
  "notificationtoken",
  "secret",
  "api_key",
  "apikey",
  "key",
  "password",
]);

/**
 * Redacts known credential and token query parameters from URLs.
 * Works with both full URLs ("https://host/path?token=xyz") and relative paths ("/path?token=xyz").
 */
export function redactSensitiveQueryParams(urlStr: string): string {
  if (!urlStr || typeof urlStr !== "string") return urlStr;
  try {
    const isRelative = !urlStr.startsWith("http://") && !urlStr.startsWith("https://");
    const parsed = new URL(urlStr, "http://localhost");
    let modified = false;

    for (const [key] of parsed.searchParams) {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, "[REDACTED]");
        modified = true;
      }
    }

    if (!modified) return urlStr;
    if (isRelative) {
      return parsed.pathname + parsed.search;
    }
    return parsed.toString();
  } catch {
    // Regex fallback for non-standard / malformed URL strings
    return urlStr.replace(
      /([?&](?:token|notification_token|notificationToken|secret|api_key|apiKey)=)[^&#]*/gi,
      "$1[REDACTED]",
    );
  }
}

/**
 * Compares two strings in constant time to defend against timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);

  if (bufA.byteLength !== bufB.byteLength) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < bufA.byteLength; i++) {
    diff |= bufA[i] ^ bufB[i];
  }
  return diff === 0;
}
