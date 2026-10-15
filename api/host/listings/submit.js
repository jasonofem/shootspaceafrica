import { requireUser } from '../../_lib/supabase.js';
import { methodNotAllowed, readBody, sendError } from '../../_lib/http.js';

export default async function handler(req,res){
  if(req.method!=='POST') return methodNotAllowed(res,['POST']);
  try {
    const {userClient}=await requireUser(req);
    const body=await readBody(req);
    if(!isUuid(body.listingId)) return res.status(400).json({error:'Listing id is required.'});
    const {data,error}=await userClient.rpc('submit_listing_for_review',{p_listing_id:body.listingId});
    if(error) throw error;
    return res.status(200).json(data);
  } catch(error){return sendError(res,error,'Listing cannot be submitted yet.');}
}
function isUuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));}
