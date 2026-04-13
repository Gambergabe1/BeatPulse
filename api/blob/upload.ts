import { handleBlobUploadRequest } from "../blob-upload-handler.ts";

export default async function handler(req: any, res: any) {
  return handleBlobUploadRequest(req, res);
}
