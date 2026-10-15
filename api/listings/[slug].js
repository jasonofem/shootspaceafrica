import { getAnonymousClient, getServiceClient } from '../_lib/supabase.js';
import { attachSignedPhotos } from '../listings.js';
import { methodNotAllowed, sendError } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const slug = String(req.query.slug || '').trim().slice(0, 120);
    if (!slug) return res.status(400).json({ error: 'Listing slug is required.' });
    const anon = getAnonymousClient();
    const service = getServiceClient();
    let request = anon.from('public_listings').select('*').eq('status', 'published');
    request = /^[0-9a-f-]{36}$/i.test(slug) ? request.eq('id', slug) : request.eq('slug', slug);
    const { data, error } = await request.maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'No published location was found.' });
    const [listing] = await attachSignedPhotos(service, [data]);
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ listing });
  } catch (error) {
    return sendError(res, error, 'Unable to load this location.');
  }
}
