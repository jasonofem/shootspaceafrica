import { requireUser } from './_lib/supabase.js';
import { methodNotAllowed, sendError } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const { userClient, user } = await requireUser(req);
    const [{ data: profile, error: profileError }, { data: roles, error: rolesError }, { data: host, error: hostError }] = await Promise.all([
      userClient.from('profiles').select('id,display_name,phone,account_status').eq('id', user.id).maybeSingle(),
      userClient.from('user_roles').select('role').eq('user_id', user.id),
      userClient.from('host_profiles').select('verification_status,public_display_name').eq('user_id', user.id).maybeSingle(),
    ]);
    if (profileError) throw profileError;
    if (rolesError) throw rolesError;
    if (hostError && hostError.code !== 'PGRST116') throw hostError;
    res.setHeader('Cache-Control', 'no-store, private');
    return res.status(200).json({ user: { id: user.id, email: user.email }, profile, roles: (roles || []).map((item) => item.role), host: host || null });
  } catch (error) { return sendError(res, error, 'Account data could not be loaded.'); }
}
