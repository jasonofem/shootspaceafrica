// Public listing area. Public URLs (unchanged):
//   GET /api/listings?<filters>   -> listings-index (the default for this function)
//   GET /api/listings/:slug       -> listings-detail
import { getAnonymousClient, getServiceClient } from '../supabase.js';
import { methodNotAllowed, sendError } from '../http.js';

const PAGE_SIZE_MAX = 24;

export async function listingIndex(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const anon = getAnonymousClient();
    const service = getServiceClient();
    const query = req.query || {};
    const page = Math.max(1, Math.min(1000, Number.parseInt(query.page || '1', 10) || 1));
    const pageSize = Math.max(1, Math.min(PAGE_SIZE_MAX, Number.parseInt(query.pageSize || '12', 10) || 12));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let request = anon.from('public_listings').select('*', { count: 'exact' }).eq('status', 'published');
    const location = cleanSearch(query.location);
    const category = cleanSearch(query.category);
    if (location) request = request.or(`city.ilike.%${location}%,neighbourhood.ilike.%${location}%`);
    if (category) request = request.ilike('category', `%${category}%`);
    if (query.maxPriceKobo && Number.isSafeInteger(Number(query.maxPriceKobo))) request = request.lte('hourly_rate_kobo', Number(query.maxPriceKobo));
    const amenities = typeof query.amenities === 'string' ? query.amenities.split(',').map(cleanSearch).filter(Boolean).slice(0, 12) : [];
    if (amenities.length) request = request.contains('amenities', amenities);
    const sort = String(query.sort || 'newest');
    if (sort === 'price_asc') request = request.order('hourly_rate_kobo', { ascending: true });
    else if (sort === 'price_desc') request = request.order('hourly_rate_kobo', { ascending: false });
    else request = request.order('created_at', { ascending: false });
    const { data, count, error } = await request.range(from, to);
    if (error) throw error;
    const listings = await attachSignedPhotos(service, data || []);
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ listings, total: count || 0, page, pageSize, hasMore: (count || 0) > to + 1 });
  } catch (error) {
    return sendError(res, error, 'Unable to load public listings.');
  }
}

export async function listingDetail(req, res) {
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

async function attachSignedPhotos(service, rows) {
  return Promise.all(rows.map(async (row) => {
    const photos = Array.isArray(row.photos) ? row.photos : [];
    const signed = await Promise.all(photos.map(async (photo) => {
      if (!photo?.storage_path) return null;
      const { data, error } = await service.storage.from('listing-photos').createSignedUrl(photo.storage_path, 3600);
      if (error || !data?.signedUrl) return null;
      return { ...photo, url: data.signedUrl };
    }));
    const safePhotos = signed.filter(Boolean);
    return { ...row, photos: safePhotos, cover_photo_url: safePhotos.find((photo) => photo.is_cover)?.url || safePhotos[0]?.url || null };
  }));
}

function cleanSearch(value) {
  return String(value || '').trim().slice(0, 80).replace(/[%,()\\]/g, ' ').replace(/\s+/g, ' ');
}

export const listingRoutes = {
  defaultRoute: 'listings-index',
  routes: {
    'listings-index': listingIndex,
    'listings-detail': listingDetail,
  },
};
