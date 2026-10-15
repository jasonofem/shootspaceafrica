import { requireUser } from './_lib/supabase.js';
import { methodNotAllowed, readBody, sendError } from './_lib/http.js';

export default async function handler(req,res){
  if(!['POST','DELETE'].includes(req.method)) return methodNotAllowed(res,['POST','DELETE']);
  try{
    const {userClient}=await requireUser(req);
    const body=await readBody(req);
    if(!isUuid(body.listingId)) return res.status(400).json({error:'Listing id is required.'});
    const saved=req.method==='POST';
    const {data,error}=await userClient.rpc('set_listing_favorite',{p_listing_id:body.listingId,p_saved:saved});
    if(error) throw error;
    return res.status(200).json(data);
  }catch(error){return sendError(res,error,'Saved location could not be updated.');}
}
function isUuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));}
