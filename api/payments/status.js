import { requireUser } from '../_lib/supabase.js';
import { methodNotAllowed, sendError } from '../_lib/http.js';

export default async function handler(req,res){
  if(req.method!=='GET') return methodNotAllowed(res,['GET']);
  try{
    const {userClient}=await requireUser(req);
    const reference=String(req.query.reference||'').trim().slice(0,100);
    if(!/^SSA-[A-Za-z0-9-]{10,90}$/.test(reference)) return res.status(400).json({error:'A valid payment reference is required.'});
    const {data,error}=await userClient.from('payments').select('booking_id,status,amount_kobo,currency').eq('provider_reference',reference).maybeSingle();
    if(error) throw error;
    if(!data) return res.status(404).json({error:'Payment was not found for this account.'});
    res.setHeader('Cache-Control','no-store, private');
    return res.status(200).json({bookingId:data.booking_id,status:data.status,amountKobo:data.amount_kobo,currency:data.currency});
  }catch(error){return sendError(res,error,'Payment status could not be checked.');}
}
