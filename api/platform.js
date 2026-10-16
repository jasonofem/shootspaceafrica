// Grouped Serverless Function for public platform reads
// (/api/amenities, /api/availability, /api/reviews, /api/settings).
import { createDispatcher } from './_lib/routes.js';
import { platformRoutes } from './_lib/endpoints/platform.js';

export default createDispatcher(platformRoutes);
