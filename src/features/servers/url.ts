// URL helpers for the Add Server flow (TASK-M1-05): normalization rules and
// the plain-HTTP risk check.

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Normalizes a raw server URL input: trims whitespace, prepends `http://`
 * when no scheme is present, strips trailing slashes, and validates with the
 * URL constructor. Returns the normalized URL or null when invalid.
 */
export function normalizeServerUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return withScheme.replace(/\/+$/, "");
}

/** True when the URL is plain HTTP on a non-loopback host. */
export function isRemotePlainHttp(urlString: string): boolean {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  return !LOCAL_HOSTNAMES.has(url.hostname);
}
