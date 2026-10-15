import { createClient } from '@supabase/supabase-js';
import { hasSupabaseClientConfig } from '../config.js';

const env = import.meta.env || {};
export const supabase = hasSupabaseClientConfig
  ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
