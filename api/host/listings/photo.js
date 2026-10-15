import { requireUser } from '../../_lib/supabase.js';
import { methodNotAllowed, readBody, sendError } from '../../_lib/http.js';

export default async function handler(req,res){
  if(req.method!=='POST') return methodNotAllowed(res,['POST']);
  try {
    const {userClient}=await requireUser(req);
    const body=await readBody(req);
    if(!isUuid(body.listingId)||typeof body.storagePath!=='string'||body.storagePath.length>600) return res.status(400).json({error:'Listing and uploaded photo are required.'});
    const {data,error}=await userClient.rpc('register_listing_photo',{
      p_listing_id:body.listingId,p_storage_path:body.storagePath,p_alt_text:String(body.altText||'').slice(0,300),p_is_cover:Boolean(body.isCover)
    });
    if(error) throw error;
    return res.status(201).json(data);
  } catch(error){return sendError(res,error,'Photo could not be added.');}
}
function isUuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));}
