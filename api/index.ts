/**
 * Single Vercel Function entry point for every /api/* request.
 *
 * The Hobby plan caps a deployment at 12 Serverless Functions, and every file
 * under /api counts as one. All route handlers therefore live in
 * /serverless/routes and are dispatched from here, so the whole API ships as
 * one function no matter how many endpoints are added. vercel.json rewrites
 * /api/<path> to /api?__route=<path>.
 *
 * Imports use the .js extension because Vercel compiles each .ts file to .js
 * and the package is ESM ("type": "module").
 */
import audioProxy from "../serverless/routes/audio-proxy.js";
import blobUpload from "../serverless/routes/blob-upload.js";
import globalScores from "../serverless/routes/global-scores.js";
import integrity from "../serverless/routes/integrity.js";
import mapReviews from "../serverless/routes/map-reviews.js";
import replays from "../serverless/routes/replays.js";
import social from "../serverless/routes/social.js";
import songs from "../serverless/routes/songs.js";
import adminLogin from "../serverless/routes/admin/login.js";
import adminPassword from "../serverless/routes/admin/password.js";
import adminRemovePlayer from "../serverless/routes/admin/remove-player.js";
import adminForceUpdate from "../serverless/routes/admin/force-update.js";

type Handler = (req: any, res: any) => unknown;

const ROUTES: Record<string, Handler> = {
  "audio-proxy": audioProxy,
  "blob/upload": blobUpload,
  "global-scores": globalScores,
  integrity,
  "map-reviews": mapReviews,
  replays,
  social,
  songs,
  "admin/login": adminLogin,
  "admin/password": adminPassword,
  "admin/leaderboard/remove-player": adminRemovePlayer,
  "admin/storage/force-update": adminForceUpdate,
};

const firstValue = (value: unknown) => (Array.isArray(value) ? value[0] : value);

const normalizeRoute = (value: string) =>
  value.split("?")[0].replace(/^\/+|\/+$/g, "").replace(/^api\/?/, "").replace(/\/{2,}/g, "/");

function resolveRequest(req: any) {
  const url = new URL(typeof req.url === "string" ? req.url : "/api", "http://localhost");
  const query: Record<string, string | string[]> = {};
  url.searchParams.forEach((value, key) => {
    const existing = query[key];
    query[key] = existing === undefined ? value : ([] as string[]).concat(existing, value);
  });
  const parsedQuery = req.query && typeof req.query === "object" ? req.query : {};
  Object.assign(query, parsedQuery);

  const rewrittenRoute = firstValue(query.__route);
  delete query.__route;
  const route = normalizeRoute(typeof rewrittenRoute === "string" ? rewrittenRoute : url.pathname);
  return { route, query };
}

function setQuery(req: any, query: Record<string, string | string[]>) {
  Object.defineProperty(req, "query", { value: query, writable: true, configurable: true, enumerable: true });
}

export default async function handler(req: any, res: any) {
  const { route, query } = resolveRequest(req);

  if (route === "health") {
    return res.status(200).json({ success: true, data: { status: "ok", time: new Date().toISOString() } });
  }

  // /api/songs/:songId/scores is served by the global-scores handler.
  const songScores = /^songs\/([^/]+)\/scores$/.exec(route);
  if (songScores) {
    let songId = songScores[1];
    try { songId = decodeURIComponent(songId); } catch { /* keep the raw segment */ }
    setQuery(req, { ...query, songId });
    return globalScores(req, res);
  }

  const routeHandler = ROUTES[route];
  if (!routeHandler) {
    return res.status(404).json({ success: false, error: `Unknown API route: /api/${route}` });
  }

  setQuery(req, query);
  return routeHandler(req, res);
}
