import { getAnonymousClient } from './_lib/supabase.js';
import { methodNotAllowed, sendError } from './_lib/http.js';

export default async function handler(req,res){
  if(req.method!=='GET') return methodNotAllowed(res,['GET']);
  try{
    const {data,error}=await getAnonymousClient().from('amenities').select('id,slug,name').eq('is_active',true).order('name');
    if(error) throw error;
    res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({amenities:data||[]});
  }catch(error){return sendError(res,error,'Amenities could not be loaded.');}
}
