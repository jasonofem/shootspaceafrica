import { randomUUID } from 'node:crypto';
import { requireUser } from '../_lib/supabase.js';
import { methodNotAllowed, readBody, sendError } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient } = await requireUser(req);
    const body = await readBody(req);
    const title = String(body.title || '').trim();
    const hourlyRateKobo = Number(body.hourlyRateKobo);
    const crewCapacity = Number(body.crewCapacity);
    const minHours = Number(body.minHours || 1);
    if (title.length < 4 || title.length > 120) return res.status(400).json({ error: 'Listing title must be 4–120 characters.' });
    if (!Number.isSafeInteger(hourlyRateKobo) || hourlyRateKobo <= 0) return res.status(400).json({ error: 'Hourly rate must be supplied in integer kobo.' });
    if (!Number.isInteger(crewCapacity) || crewCapacity < 1 || crewCapacity > 500) return res.status(400).json({ error: 'Enter a crew capacity between 1 and 500.' });
    const amenities = Array.isArray(body.amenityIds) ? body.amenityIds.filter((id) => isUuid(id)).slice(0, 30) : [];
    const rules = Array.isArray(body.houseRules) ? body.houseRules.map((rule) => String(rule).trim().slice(0, 400)).filter(Boolean).slice(0, 40) : [];
    const availability = Array.isArray(body.availability) ? body.availability.slice(0, 21) : [];
    const slug = `${slugify(title)}-${randomUUID().slice(0, 8)}`;
    const { data, error } = await userClient.rpc('create_listing_draft', {
      p_slug: slug,
      p_title: title,
      p_category: String(body.category || '').trim().slice(0, 80),
      p_description: String(body.description || '').trim().slice(0, 5000),
      p_city: String(body.city || '').trim().slice(0, 100),
      p_neighbourhood: String(body.neighbourhood || '').trim().slice(0, 120),
      p_public_location: String(body.publicLocation || '').trim().slice(0, 250),
      p_exact_address: String(body.exactAddress || '').trim().slice(0, 500),
      p_hourly_rate_kobo: hourlyRateKobo,
      p_min_hours: minHours,
      p_crew_capacity: crewCapacity,
      p_house_rules: rules,
      p_amenity_ids: amenities,
      p_availability: availability,
    });
    if (error) throw error;
    return res.status(201).json({ ...data, status: 'draft', message: 'Draft saved. Submit it for review after adding real listing photos and availability.' });
  } catch (error) { return sendError(res, error, 'Listing draft could not be saved.'); }
}
function slugify(value) { return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'location'; }
function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')); }
