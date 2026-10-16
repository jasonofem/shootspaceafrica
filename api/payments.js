// Grouped Serverless Function for payments (/api/payments/initialize, /api/payments/status).
// The Paystack webhook stays separate at /api/webhooks/paystack (raw body required).
import { createDispatcher } from './_lib/routes.js';
import { paymentRoutes } from './_lib/endpoints/payments.js';

export default createDispatcher(paymentRoutes);
