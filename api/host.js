// Grouped Serverless Function for the host area (/api/host/*).
// vercel.json rewrites map the public URLs to a route key; see api/_lib/routes.js.
import { createDispatcher } from './_lib/routes.js';
import { hostRoutes } from './_lib/endpoints/host.js';

export default createDispatcher(hostRoutes);
