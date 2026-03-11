import { handleBlobUploadRequest } from "../blob-upload-handler";

export default async function handler(req: any, res: any) {
  return handleBlobUploadRequest(req, res);
}
