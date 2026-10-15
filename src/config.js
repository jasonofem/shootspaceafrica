const env = import.meta.env || {};

export const publicSettings = Object.freeze({
  productName: 'ShootSpace Africa',
  phoneDisplay: env.VITE_PUBLIC_PHONE || '09131556692',
  phoneE164: env.VITE_PUBLIC_PHONE_E164 || '+2349131556692',
  whatsappUrl: env.VITE_PUBLIC_WHATSAPP_URL || 'https://wa.me/2349131556692',
  email: env.VITE_PUBLIC_EMAIL || 'jasonofem79@gmail.com',
  instagramHandle: env.VITE_PUBLIC_INSTAGRAM_HANDLE || '@jasonofem',
  instagramUrl: env.VITE_CONFIRMED_INSTAGRAM_URL || '',
  linkedInName: env.VITE_PUBLIC_LINKEDIN_NAME || 'Jasonofem',
  linkedInUrl: env.VITE_CONFIRMED_LINKEDIN_URL || '',
});

export const isDevelopment = Boolean(env.DEV);
export const hasSupabaseClientConfig = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);
export const bookingEnabled = env.VITE_BOOKING_ENABLED === 'true';
export const paymentEnabled = env.VITE_PAYMENT_ENABLED === 'true';
