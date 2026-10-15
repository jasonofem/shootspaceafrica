import { requireUser } from '../_lib/supabase.js';
import { methodNotAllowed, readBody, sendError } from '../_lib/http.js';

export default async function handler(req,res){
  if(req.method!=='POST') return methodNotAllowed(res,['POST']);
  try{
    const {userClient}=await requireUser(req);
    const body=await readBody(req);
    if(!isUuid(body.bookingId)) return res.status(400).json({error:'Booking id is required.'});
    const {data,error}=await userClient.rpc('cancel_unpaid_booking',{p_booking_id:body.bookingId,p_reason:String(body.reason||'').slice(0,1000)});
    if(error) throw error;
    return res.status(200).json(data);
  }catch(error){return sendError(res,error,'Booking cannot be cancelled through this flow.');}
}
function isUuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));}
