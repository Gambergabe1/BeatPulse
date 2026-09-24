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

export default async function handler(req: any, res: any) {
  const audioUrl = getQueryValue(req, "url");
  if (!audioUrl) {
    return res.status(400).send("Missing URL");
  }

  try {
    const forwardedProtoHeader = req.headers?.["x-forwarded-proto"];
    const forwardedProto = Array.isArray(forwardedProtoHeader)
      ? forwardedProtoHeader[0]
      : typeof forwardedProtoHeader === "string" && forwardedProtoHeader.trim()
      ? forwardedProtoHeader.split(",")[0]
      : "https";
    const host = typeof req.headers?.host === "string" && req.headers.host.trim()
      ? req.headers.host.trim()
      : "localhost";
    const baseUrl = `${forwardedProto}://${host}`;
    const resolvedUrl = new URL(audioUrl, baseUrl).toString();

    const response = await fetch(resolvedUrl);
    if (!response.ok) {
      return res.status(response.status).send("Failed to fetch audio");
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("Content-Type") || "application/octet-stream";
    if (typeof res.setHeader === "function") {
      res.setHeader("Content-Type", contentType);
    }
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("Proxy error:", error);
    return res.status(500).send("Internal Server Error");
  }
}
