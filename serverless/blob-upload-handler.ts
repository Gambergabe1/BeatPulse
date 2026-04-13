import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

const AUDIO_UPLOAD_MAX_BYTES = 1024 * 1024 * 150;
const NOTES_UPLOAD_MAX_BYTES = 1024 * 1024 * 8;
const UPLOAD_TOKEN_TTL_MS = 1000 * 60 * 10;

function parseBody(body: unknown): HandleUploadBody {
  if (typeof body === "string") {
    return JSON.parse(body) as HandleUploadBody;
  }

  return body as HandleUploadBody;
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

  let body: HandleUploadBody;
  try {
    body = parseBody(req.body);
  } catch {
    return res.status(400).json({ error: "Invalid upload payload." });
  }

  try {
    const json = await handleUpload({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      request: req,
      body,
      onBeforeGenerateToken: async (pathname) => {
        if (!isValidSongUploadPath(pathname)) {
          throw new Error("Invalid upload path.");
        }

        return {
          allowedContentTypes: getAllowedContentTypes(pathname),
          maximumSizeInBytes: getMaximumUploadSize(pathname),
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: Date.now() + UPLOAD_TOKEN_TTL_MS,
        };
      },
    });

    return res.status(200).json(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to prepare upload.";
    return res.status(400).json({ error: message });
  }
}
