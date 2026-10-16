// Grouped Serverless Function for the admin area (/api/admin/*).
// vercel.json rewrites map the public URLs to a route key; see api/_lib/routes.js.
import { createDispatcher } from './_lib/routes.js';
import { adminRoutes } from './_lib/endpoints/admin.js';

export default createDispatcher(adminRoutes);
