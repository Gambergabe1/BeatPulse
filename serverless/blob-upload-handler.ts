import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";

const AUDIO_UPLOAD_MAX_BYTES = 1024 * 1024 * 150;
const NOTES_UPLOAD_MAX_BYTES = 1024 * 1024 * 8;
const UPLOAD_TOKEN_TTL_MS = 1000 * 60 * 10;

interface ParsedTokenRequest {
  pathname: string;
  multipart: boolean;
}

function parseBodyValue(body: unknown): unknown {
  if (typeof body === "string") {
    return JSON.parse(body) as unknown;
  }

  return body;
}

function readRawBody(req: any) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function parseBody(req: any): Promise<unknown> {
  if (req.body !== undefined && req.body !== null && req.body !== "") {
    return parseBodyValue(req.body);
  }

  const rawBody = await readRawBody(req);
  if (!rawBody.trim()) return {};
  return parseBodyValue(rawBody);
}

function extractTokenRequest(body: unknown): ParsedTokenRequest | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const typedBody = body as {
    type?: unknown;
    payload?: { pathname?: unknown; multipart?: unknown };
    pathname?: unknown;
    multipart?: unknown;
  };

  if (typedBody.type === "blob.upload-completed") {
    return null;
  }

  if (typedBody.type === "blob.generate-client-token") {
    const pathname = typedBody.payload?.pathname;
    if (typeof pathname !== "string" || !pathname.trim()) {
      return null;
    }

    return {
      pathname: pathname.trim(),
      multipart: Boolean(typedBody.payload?.multipart),
    };
  }

  if (typeof typedBody.pathname === "string" && typedBody.pathname.trim()) {
    return {
      pathname: typedBody.pathname.trim(),
      multipart: Boolean(typedBody.multipart),
    };
  }

  return null;
}

function isNotesUpload(pathname: string) {
  return pathname.endsWith("/notes.json");
}

function isValidSongUploadPath(pathname: string) {
  return /^songs\/[A-Za-z0-9-]{8,64}\/[A-Za-z0-9_.-]{1,180}$/.test(pathname);
}

function getAllowedContentTypes(pathname: string) {
  return isNotesUpload(pathname)
    ? ["application/json"]
    : ["audio/*", "application/octet-stream"];
}

function getMaximumUploadSize(pathname: string) {
  return isNotesUpload(pathname) ? NOTES_UPLOAD_MAX_BYTES : AUDIO_UPLOAD_MAX_BYTES;
}

export async function handleBlobUploadRequest(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: "BLOB_READ_WRITE_TOKEN is not configured." });
  }

  let body: unknown;
  try {
    body = await parseBody(req);
  } catch {
    return res.status(400).json({ error: "Invalid upload payload." });
  }

  if ((body as { type?: unknown } | null)?.type === "blob.upload-completed") {
    return res.status(200).json({ type: "blob.upload-completed", response: "ok" });
  }

  const tokenRequest = extractTokenRequest(body);
  if (!tokenRequest) {
    return res.status(400).json({ error: "Invalid upload request." });
  }

  try {
    if (!isValidSongUploadPath(tokenRequest.pathname)) {
      throw new Error("Invalid upload path.");
    }

    const clientToken = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathname: tokenRequest.pathname,
      allowedContentTypes: getAllowedContentTypes(tokenRequest.pathname),
      maximumSizeInBytes: getMaximumUploadSize(tokenRequest.pathname),
      addRandomSuffix: false,
      allowOverwrite: false,
      validUntil: Date.now() + UPLOAD_TOKEN_TTL_MS,
    });

    return res.status(200).json({
      type: "blob.generate-client-token",
      clientToken,
      multipart: tokenRequest.multipart,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to prepare upload.";
    return res.status(400).json({ error: message });
  }
}
