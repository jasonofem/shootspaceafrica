import { createClient } from '@supabase/supabase-js';

export class ApiError extends Error {
  constructor(message, statusCode = 500, code = '') { super(message); this.statusCode = statusCode; this.code = code; }
}

function supabaseUrl() { return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''; }
function anonKey() { return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''; }

export function requireSupabasePublicConfig() {
  const url = supabaseUrl();
  const key = anonKey();
  if (!url || !key) throw new ApiError('Supabase project is not configured.', 503);
  return { url, key };
}

export function getServiceClient() {
  const { url } = requireSupabasePublicConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new ApiError('Server-side database service is not configured.', 503);
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function getAnonymousClient() {
  const { url, key } = requireSupabasePublicConfig();
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function requireUser(req) {
  const authorization = req.headers.authorization || '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new ApiError('authentication_required', 401, '28000');
  const { url, key } = requireSupabasePublicConfig();
  const userClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) throw new ApiError('authentication_required', 401, '28000');
  return { userClient, user: data.user };
}

export async function requireRole(userClient, userId, role) {
  const { data, error } = await userClient.from('user_roles').select('role').eq('user_id', userId).eq('role', role).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(`${role}_role_required`, 403, '42501');
  return true;
}
