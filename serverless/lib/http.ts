export function ok(res: any, data: unknown) {
  return res.status(200).json({ success: true, data });
}

export function fail(res: any, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

export function parseRequestBody(req: any): Record<string, unknown> {
  if (req.body && typeof req.body === "object") return req.body as Record<string, unknown>;
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      const parsed = JSON.parse(req.body);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}
