// Host area. Public URLs (unchanged):
//   POST /api/host/onboarding             -> host-onboarding
//   POST /api/host/verification-document  -> host-verification-document
//   POST /api/host/listings               -> host-listings-create
//   POST /api/host/listings/photo         -> host-listing-photo
//   POST /api/host/listings/submit        -> host-listing-submit
import { randomUUID } from 'node:crypto';
import { requireUser } from '../supabase.js';
import { methodNotAllowed, readBody, sendError } from '../http.js';

export async function hostOnboarding(req, res) {
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

export async function registerVerificationDocument(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient } = await requireUser(req);
    const body = await readBody(req);
    if (!documentTypes.has(String(body.documentType)) || typeof body.storagePath !== 'string' || body.storagePath.length > 600) return res.status(400).json({ error: 'Document type and uploaded private file are required.' });
    const { data, error } = await userClient.rpc('register_host_verification_document', { p_document_type: body.documentType, p_storage_path: body.storagePath });
    if (error) throw error;
    res.setHeader('Cache-Control', 'no-store, private');
    return res.status(201).json(data);
  } catch (error) { return sendError(res, error, 'Private verification document could not be registered.'); }
}

export async function createListingDraft(req, res) {
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

export async function registerListingPhoto(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient } = await requireUser(req);
    const body = await readBody(req);
    if (!isUuid(body.listingId) || typeof body.storagePath !== 'string' || body.storagePath.length > 600) return res.status(400).json({ error: 'Listing and uploaded photo are required.' });
    const { data, error } = await userClient.rpc('register_listing_photo', {
      p_listing_id: body.listingId, p_storage_path: body.storagePath, p_alt_text: String(body.altText || '').slice(0, 300), p_is_cover: Boolean(body.isCover),
    });
    if (error) throw error;
    return res.status(201).json(data);
  } catch (error) { return sendError(res, error, 'Photo could not be added.'); }
}

export async function submitListing(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient } = await requireUser(req);
    const body = await readBody(req);
    if (!isUuid(body.listingId)) return res.status(400).json({ error: 'Listing id is required.' });
    const { data, error } = await userClient.rpc('submit_listing_for_review', { p_listing_id: body.listingId });
    if (error) throw error;
    return res.status(200).json(data);
  } catch (error) { return sendError(res, error, 'Listing cannot be submitted yet.'); }
}

const documentTypes = new Set(['government_id', 'proof_of_address', 'ownership_authorization', 'other']);

function slugify(value) { return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'location'; }
function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')); }

export const hostRoutes = {
  defaultRoute: null,
  routes: {
    'host-onboarding': hostOnboarding,
    'host-verification-document': registerVerificationDocument,
    'host-listings-create': createListingDraft,
    'host-listing-photo': registerListingPhoto,
    'host-listing-submit': submitListing,
  },
};
