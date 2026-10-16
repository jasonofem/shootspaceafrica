// Grouped Serverless Function for the booking area (/api/bookings/* and /api/my-bookings).
// vercel.json rewrites map the public URLs to a route key; see api/_lib/routes.js.
import { createDispatcher } from './_lib/routes.js';
import { bookingRoutes } from './_lib/endpoints/bookings.js';

export default createDispatcher(bookingRoutes);
