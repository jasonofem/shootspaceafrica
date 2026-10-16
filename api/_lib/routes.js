// Grouped route dispatch.
//
// Vercel Hobby allows at most 12 Serverless Functions per deployment, so the
// public API is grouped into a small number of function files (one per area).
// `vercel.json` rewrites keep every existing public URL working and pass the
// target route key through the `route` query parameter, which Vercel merges
// into `req.query` without dropping the caller's own query parameters.
//
// Route tables are plain objects: { defaultRoute: string|null, routes: { key: handler } }.

export const ROUTE_QUERY_KEY = 'route';

export function createDispatcher(table) {
  const routes = table?.routes || {};
  const fallback = table?.defaultRoute || null;

  return async function dispatch(req, res) {
    const requested = readRouteKey(req);
    const key = Object.prototype.hasOwnProperty.call(routes, requested) ? requested : fallback;
    const handler = key && Object.prototype.hasOwnProperty.call(routes, key) ? routes[key] : null;
    if (typeof handler !== 'function') {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).json({ error: 'This API endpoint was not found.' });
    }
    return handler(req, res);
  };
}

function readRouteKey(req) {
  const value = req?.query?.[ROUTE_QUERY_KEY];
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.trim() : '';
}

export function routeKeys(table) {
  return Object.keys(table?.routes || {});
}
