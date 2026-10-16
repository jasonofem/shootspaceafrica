// Grouped Serverless Function for the account area
// (/api/me, /api/dashboard, /api/favorites, /api/contact).
import { createDispatcher } from './_lib/routes.js';
import { accountRoutes } from './_lib/endpoints/account.js';

export default createDispatcher(accountRoutes);
