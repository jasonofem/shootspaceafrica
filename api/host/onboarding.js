import { requireUser } from '../_lib/supabase.js';
import { methodNotAllowed, readBody, sendError } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient } = await requireUser(req);
    const body = await readBody(req);
    const displayName = String(body.displayName || '').trim();
    const bio = String(body.bio || '').trim();
    if (displayName.length < 2 || displayName.length > 120 || bio.length > 3000) return res.status(400).json({ error: 'Enter a public host name (2–120 characters) and a short bio.' });
    const { data, error } = await userClient.rpc('request_host_role', { p_display_name: displayName, p_bio: bio, p_terms_accepted: body.termsAccepted === true });
    if (error) throw error;
    return res.status(201).json({ verification_status: data.status, message: 'Host onboarding is pending review. No listing has been published.' });
  } catch (error) { return sendError(res, error, 'Host onboarding could not be submitted.'); }
}
