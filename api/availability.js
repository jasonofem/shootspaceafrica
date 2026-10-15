import { getAnonymousClient } from './_lib/supabase.js';
import { methodNotAllowed, sendError } from './_lib/http.js';

export default async function handler(req,res){
  if(req.method!=='GET') return methodNotAllowed(res,['GET']);
  const listingId=String(req.query.listingId||'');
  const date=String(req.query.date||'');
  if(!isUuid(listingId)||!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({error:'A valid listing and date are required.'});
  try{
    const start=new Date(`${date}T00:00:00+01:00`);
    if(!Number.isFinite(start.valueOf())) return res.status(400).json({error:'Choose a valid calendar date.'});
    const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos'}).format(start);
    if(localDate!==date) return res.status(400).json({error:'Choose a valid calendar date.'});
    const end=new Date(start.valueOf()+24*60*60*1000);
    const db=getAnonymousClient();
    const [rules,busy,exceptions]=await Promise.all([
      db.from('public_availability').select('weekday,opens_at,closes_at,timezone').eq('listing_id',listingId),
      db.from('public_busy_slots').select('starts_at,ends_at').eq('listing_id',listingId).lt('starts_at',end.toISOString()).gt('ends_at',start.toISOString()),
      db.from('public_availability_exceptions').select('starts_at,ends_at').eq('listing_id',listingId).lt('starts_at',end.toISOString()).gt('ends_at',start.toISOString()),
    ]);
    for(const result of [rules,busy,exceptions]) if(result.error) throw result.error;
    const weekday=new Intl.DateTimeFormat('en-US',{timeZone:'Africa/Lagos',weekday:'short'}).format(start);
    const dayMap={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
    res.setHeader('Cache-Control','public, s-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({
      date,weekday:dayMap[weekday],timezone:'Africa/Lagos',
      openingHours:(rules.data||[]).filter((item)=>Number(item.weekday)===dayMap[weekday]),
      busySlots:busy.data||[],blockedIntervals:exceptions.data||[],
    });
  }catch(error){return sendError(res,error,'Availability could not be loaded.');}
}
function isUuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);}
