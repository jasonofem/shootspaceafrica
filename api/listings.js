// Grouped Serverless Function for public listings (/api/listings and /api/listings/:slug).
// vercel.json rewrites map the public URLs to a route key; see api/_lib/routes.js.
import { createDispatcher } from './_lib/routes.js';
import { listingRoutes } from './_lib/endpoints/listings.js';

export default createDispatcher(listingRoutes);
