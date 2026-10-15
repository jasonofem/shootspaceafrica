import { requireUser } from '../_lib/supabase.js';
import { methodNotAllowed, readBody, sendError } from '../_lib/http.js';

export default async function handler(req,res){
  if(req.method!=='POST') return methodNotAllowed(res,['POST']);
  try{
    const {userClient}=await requireUser(req);
    const body=await readBody(req);
    if(!isUuid(body.disputeId)||typeof body.storagePath!=='string'||body.storagePath.length>700) return res.status(400).json({error:'Dispute and uploaded evidence are required.'});
    const {data,error}=await userClient.rpc('register_dispute_evidence',{p_dispute_id:body.disputeId,p_storage_path:body.storagePath});
    if(error) throw error;
    return res.status(201).json(data);
  }catch(error){return sendError(res,error,'Evidence could not be registered.');}
}
function isUuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));}
