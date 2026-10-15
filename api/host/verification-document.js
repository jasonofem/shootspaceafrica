import { requireUser } from '../_lib/supabase.js';
import { methodNotAllowed, readBody, sendError } from '../_lib/http.js';

const types=new Set(['government_id','proof_of_address','ownership_authorization','other']);
export default async function handler(req,res){
  if(req.method!=='POST') return methodNotAllowed(res,['POST']);
  try{
    const {userClient}=await requireUser(req);
    const body=await readBody(req);
    if(!types.has(String(body.documentType))||typeof body.storagePath!=='string'||body.storagePath.length>600) return res.status(400).json({error:'Document type and uploaded private file are required.'});
    const {data,error}=await userClient.rpc('register_host_verification_document',{p_document_type:body.documentType,p_storage_path:body.storagePath});
    if(error) throw error;
    res.setHeader('Cache-Control','no-store, private');
    return res.status(201).json(data);
  }catch(error){return sendError(res,error,'Private verification document could not be registered.');}
}
