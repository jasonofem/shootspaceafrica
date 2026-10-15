// Development-only visual fixtures. This module is dynamically imported only when Vite DEV is true.
// Records and images are fictional, visibly labelled, and never bookable.
import creativeLoft from './dev-fixtures/assets/creative-loft.jpg';
import gardenVilla from './dev-fixtures/assets/garden-villa.jpg';
import neonStudio from './dev-fixtures/assets/neon-studio.jpg';
import penthouse from './dev-fixtures/assets/penthouse.jpg';
import warehouse from './dev-fixtures/assets/warehouse.jpg';

export const sampleListings=[
  {
    id:'sample-asteria-penthouse',slug:'asteria-penthouse',title:'Asteria Penthouse',category:'Luxury Penthouse',city:'Lagos',neighbourhood:'Lekki Phase 1',hourly_rate_kobo:9500000,
    cover_photo_url:penthouse,photos:[{url:penthouse,is_cover:true},{url:gardenVilla}],description:'Illustrative design preview of a multi-level penthouse concept with skyline views and large windows.',
    amenities:['Generator','Parking','Changing Room','Soundproof Room','WiFi','Kitchen'],house_rules:['Sample rule: host approval is required before any production.'],crew_capacity:20,min_hours:2,booking_mode:'request',host_verification_status:'sample',status:'sample',average_rating:null,review_count:0,isSample:true,
  },
  {
    id:'sample-volt-neon-studio',slug:'volt-neon-studio',title:'Volt Neon Studio',category:'Music Video',city:'Lagos',neighbourhood:'Victoria Island',hourly_rate_kobo:7200000,
    cover_photo_url:neonStudio,photos:[{url:neonStudio,is_cover:true}],description:'Illustrative neon-lit production studio concept for music videos and creator content.',
    amenities:['Generator','Parking','Soundproof Room','WiFi','Kitchen','Changing Room'],house_rules:[],crew_capacity:14,min_hours:2,booking_mode:'request',host_verification_status:'sample',status:'sample',average_rating:null,review_count:0,isSample:true,
  },
  {
    id:'sample-foundry-warehouse',slug:'foundry-warehouse',title:'Foundry Warehouse',category:'Warehouse',city:'Lagos',neighbourhood:'Ikeja GRA',hourly_rate_kobo:6000000,
    cover_photo_url:warehouse,photos:[{url:warehouse,is_cover:true}],description:'Illustrative high-ceiling industrial location concept for larger production crews.',
    amenities:['Parking','High Ceilings','Power Backup','Generator','WiFi'],house_rules:[],crew_capacity:30,min_hours:2,booking_mode:'request',host_verification_status:'sample',status:'sample',average_rating:null,review_count:0,isSample:true,
  },
  {
    id:'sample-kole-creative-loft',slug:'kole-creative-loft',title:'Kole Creative Loft',category:'Creative Studio',city:'Lagos',neighbourhood:'Yaba',hourly_rate_kobo:4800000,
    cover_photo_url:creativeLoft,photos:[{url:creativeLoft,is_cover:true}],description:'Illustrative creative loft concept for editorial shoots and interviews.',
    amenities:['Natural Lighting','Parking','Changing Room','WiFi'],house_rules:[],crew_capacity:12,min_hours:2,booking_mode:'request',host_verification_status:'sample',status:'sample',average_rating:null,review_count:0,isSample:true,
  },
  {
    id:'sample-eden-garden-venue',slug:'eden-garden-venue',title:'Eden Garden Venue',category:'Garden Venue',city:'Lagos',neighbourhood:'Ikoyi',hourly_rate_kobo:8200000,
    cover_photo_url:gardenVilla,photos:[{url:gardenVilla,is_cover:true}],description:'Illustrative modern villa concept with a tropical garden and bright interiors.',
    amenities:['Generator','Parking','Kitchen','Power Backup','Garden'],house_rules:[],crew_capacity:20,min_hours:2,booking_mode:'request',host_verification_status:'sample',status:'sample',average_rating:null,review_count:0,isSample:true,
  },
];
