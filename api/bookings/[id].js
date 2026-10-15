import { requireUser } from '../_lib/supabase.js';
import { methodNotAllowed, sendError } from '../_lib/http.js';

const safeColumns='id,public_code,listing_id,listing_title_snapshot,listing_city_snapshot,listing_neighbourhood_snapshot,starts_at,ends_at,crew_size,production_type,booking_status,payment_status,payout_status,total_amount_kobo,creator_fee_kobo,host_share_kobo_snapshot';
const privateStatuses=new Set(['confirmed','checked_in','completion_pending','completed','disputed']);
export default async function handler(req,res){
  if(req.method!=='GET') return methodNotAllowed(res,['GET']);
  try{
    const {userClient}=await requireUser(req);
    const id=String(req.query.id||'');
    if(!isUuid(id)) return res.status(400).json({error:'A valid booking id is required.'});
    const {data:row,error}=await userClient.from('bookings').select(safeColumns).eq('id',id).maybeSingle();
    if(error) throw error;
    if(!row) return res.status(404).json({error:'Booking was not found for this account.'});
    let privateDetails=null;
    if(row.payment_status==='paid'&&privateStatuses.has(row.booking_status)){
      const result=await userClient.rpc('get_booking_private_details',{p_booking_id:id});
      if(result.error) throw result.error;
      privateDetails=result.data;
    }
    res.setHeader('Cache-Control','no-store, private');
    return res.status(200).json({booking:{...row,...(privateDetails||{}),listing:privateDetails?.listing||{title:row.listing_title_snapshot,city:row.listing_city_snapshot,neighbourhood:row.listing_neighbourhood_snapshot}},privateDetailsAvailable:Boolean(privateDetails)});
  }catch(error){return sendError(res,error,'Booking details could not be loaded.');}
}
function isUuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));}
