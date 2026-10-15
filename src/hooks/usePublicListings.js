import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseClientConfig } from '../config.js';
import { normalizeListing } from '../data.js';

const EMPTY_FILTERS = Object.freeze({});

export function usePublicListings(filters = EMPTY_FILTERS, slug = '') {
  const queryKey = useMemo(() => JSON.stringify(filters), [filters]);
  const [state, setState] = useState({ listings: [], loading: true, error: '', sample: false, total: 0, page: 1, hasMore: false });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setState((current) => ({ ...current, loading: true, error: '' }));
      try {
        if (!hasSupabaseClientConfig && import.meta.env.DEV) {
          const { sampleListings } = await import('../dev-fixtures.js');
          const decodedFilters = JSON.parse(queryKey);
          let listings = sampleListings.map(normalizeListing);
          if (slug) listings = listings.filter((item) => item.id === slug || item.uuid === slug);
          if (decodedFilters.location) {
            const location = decodedFilters.location.toLowerCase();
            listings = listings.filter((item) => `${item.city} ${item.area}`.toLowerCase().includes(location));
          }
          if (decodedFilters.category) {
            const category = decodedFilters.category.toLowerCase().replace(/s$/, '');
            listings = listings.filter((item) => `${item.category} ${item.name}`.toLowerCase().includes(category));
          }
          if (decodedFilters.maxPriceKobo) listings = listings.filter((item) => item.price <= Number(decodedFilters.maxPriceKobo));
          if (decodedFilters.amenities?.length) listings = listings.filter((item) => decodedFilters.amenities.every((amenity) => item.amenities.includes(amenity)));
          const total = listings.length;
          if (!cancelled) setState({ listings, loading: false, error: '', sample: true, total, page: 1, hasMore: false });
          return;
        }

        const params = new URLSearchParams();
        Object.entries(JSON.parse(queryKey)).forEach(([key, value]) => {
          if (value === '' || value == null || (Array.isArray(value) && !value.length)) return;
          params.set(key, Array.isArray(value) ? value.join(',') : String(value));
        });
        const endpoint = slug ? `/api/listings/${encodeURIComponent(slug)}` : `/api/listings${params.size ? `?${params.toString()}` : ''}`;
        const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'The listing service is not available yet.');
        const rows = slug ? (result.listing ? [result.listing] : []) : (result.listings || []);
        const listings = rows.map(normalizeListing);
        if (!cancelled) setState({ listings, loading: false, error: '', sample: false, total: Number(result.total ?? listings.length), page: Number(result.page || 1), hasMore: Boolean(result.hasMore) });
      } catch (error) {
        if (!cancelled) setState({ listings: [], loading: false, error: error.message || 'Unable to load locations. Please try again.', sample: false, total: 0, page: 1, hasMore: false });
      }
    };
    load();
    return () => { cancelled = true; };
  }, [queryKey, slug]);

  return state;
}
