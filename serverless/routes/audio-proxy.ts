function getQueryValue(req: any, key: string) {
  const queryValue = req.query?.[key];
  if (Array.isArray(queryValue)) {
    return queryValue[0];
  }
  if (queryValue !== undefined && queryValue !== null) {
    return String(queryValue);
  }

  const rawUrl = typeof req.url === "string" ? req.url : "/api/audio-proxy";
  const parsedUrl = new URL(rawUrl, "http://localhost");
  return parsedUrl.searchParams.get(key);
}

/**
 * Fallback only: the client loads song assets straight from Blob storage and uses
 * this proxy when that fails. It is restricted to Vercel Blob URLs so it cannot be
 * used to make the server fetch arbitrary addresses.
 */
export function isAllowedAssetUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export default async function handler(req: any, res: any) {
  const audioUrl = getQueryValue(req, "url");
  if (!audioUrl) {
    return res.status(400).send("Missing URL");
  }
  if (!isAllowedAssetUrl(audioUrl)) {
    return res.status(400).send("Only stored song assets can be proxied.");
  }

  try {
    const response = await fetch(audioUrl, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      return res.status(response.status).send("Failed to fetch audio");
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("Content-Type") || "application/octet-stream";
    if (typeof res.setHeader === "function") {
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    }
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("Proxy error:", error);
    return res.status(500).send("Internal Server Error");
  }
}
