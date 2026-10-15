export const categories=[
  'Luxury Penthouse','Neon Studio','Modern Apartment','Warehouse','Garden Venue',
  'Creative Studio','Hotel','Restaurant','Traditional Home','Office Space','Music Video',
];

export const amenityLabels=['Generator','Soundproof Room','Changing Room','Parking','High Ceilings','Power Backup','Natural Lighting','WiFi','Kitchen','Garden','Loading Bay'];

export const faqs=[
  {question:'How does booking work?',answer:'A creator sends a request for an available time. The host must accept it. Payment and confirmation are separate steps; a request is not a confirmed booking.'},
  {question:'Can I pay online now?',answer:'Online payment remains disabled until the owner configures and approves the payment provider, database settings, cancellation terms and operating process.'},
  {question:'When does a location appear in search?',answer:'Only a host-approved listing with approved photos is returned by public discovery. The current preview may contain clearly marked development samples, which cannot be booked.'},
  {question:'When is a host paid?',answer:'Check-in does not release a payout. Completed bookings remain held while configured payout timing and any disputes are reviewed. This product does not claim escrow or automatic transfer.'},
  {question:'Where can I get help?',answer:'Use the contact form or the founder’s public contact channels. Support hours have not been published.'},
];

export function money(kobo=0){
  let amount;
  try{amount=BigInt(kobo||0);}catch{amount=0n;}
  const whole=amount/100n;
  const fraction=amount%100n;
  return `₦${whole.toLocaleString('en-NG')}${fraction?`.${fraction.toString().padStart(2,'0')}`:''}`;
}

export function normalizeListing(row){
  const photos=Array.isArray(row?.photos)?row.photos:[];
  const image=row?.cover_photo_url||photos.find((photo)=>photo.is_cover)?.url||photos[0]?.url||'/images/space-placeholder.svg';
  const houseRules=Array.isArray(row?.house_rules)?row.house_rules:typeof row?.house_rules==='string'?row.house_rules.split('\n').filter(Boolean):[];
  const amenities=Array.isArray(row?.amenities)?row.amenities.map((item)=>typeof item==='string'?item:item?.name).filter(Boolean):[];
  return {
    id:row?.slug||row?.id,
    uuid:row?.id,
    name:row?.title||'Production space',
    category:row?.category||'Production space',
    area:row?.neighbourhood||'',
    city:row?.city||'',
    price:row?.hourly_rate_kobo??0,
    rating:row?.average_rating==null?null:Number(row.average_rating),
    reviews:Number(row?.review_count||0),
    image,
    images:photos.map((photo)=>photo.url).filter(Boolean),
    description:row?.description||'',
    amenities,
    rules:houseRules,
    capacity:Number(row?.crew_capacity||0),
    minHours:Number(row?.min_hours||1),
    bookingMode:row?.booking_mode||'request',
    verified:row?.host_verification_status==='approved'&&row?.status==='published',
    isSample:Boolean(row?.isSample),
  };
}
