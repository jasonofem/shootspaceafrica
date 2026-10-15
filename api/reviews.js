import { getAnonymousClient } from './_lib/supabase.js';
import { methodNotAllowed, sendError } from './_lib/http.js';

export default async function handler(req,res){
  if(req.method!=='GET') return methodNotAllowed(res,['GET']);
  const listingId=String(req.query.listingId||'');
  if(!isUuid(listingId)) return res.status(400).json({error:'A valid listing is required.'});
  try{
    const {data,error}=await getAnonymousClient().from('reviews').select('rating,body,created_at').eq('listing_id',listingId).eq('moderation_status','published').order('created_at',{ascending:false}).limit(30);
    if(error) throw error;
    res.setHeader('Cache-Control','public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({reviews:data||[]});
  }catch(error){return sendError(res,error,'Reviews could not be loaded.');}
}
function isUuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);}
