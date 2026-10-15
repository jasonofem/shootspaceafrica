import { requireUser } from './_lib/supabase.js';
import { methodNotAllowed, sendError } from './_lib/http.js';

export default async function handler(req,res){
  if(req.method!=='GET') return methodNotAllowed(res,['GET']);
  try{
    const {userClient,user}=await requireUser(req);
    const {data,error}=await userClient.from('bookings').select('id,public_code,listing_title_snapshot,starts_at,ends_at,booking_status,payment_status,payout_status').or(`creator_id.eq.${user.id},host_id.eq.${user.id}`).order('starts_at',{ascending:false}).limit(100);
    if(error) throw error;
    res.setHeader('Cache-Control','no-store, private');
    return res.status(200).json({bookings:data||[]});
  }catch(error){return sendError(res,error,'Booking records could not be loaded.');}
}
