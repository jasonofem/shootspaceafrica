import { getServiceClient } from '../_lib/supabase.js';
import { methodNotAllowed, sendError } from '../_lib/http.js';

export default async function handler(req,res){
  if(!['GET','POST'].includes(req.method)) return methodNotAllowed(res,['GET','POST']);
  const secret=process.env.CRON_SECRET;
  const authorization=String(req.headers.authorization||'');
  if(!secret||!authorization.startsWith('Bearer ')||authorization.slice(7)!==secret) return res.status(401).json({error:'Unauthorized.'});
  try{
    const service=getServiceClient();
    const [expired,released]=await Promise.all([
      service.rpc('expire_stale_bookings'),
      service.rpc('release_mature_payouts'),
    ]);
    if(expired.error) throw expired.error;
    if(released.error) throw released.error;
    res.setHeader('Cache-Control','no-store');
    return res.status(200).json({expiredBookings:Number(expired.data||0),payoutsMadeEligible:Number(released.data||0),transfersSent:0});
  }catch(error){return sendError(res,error,'Scheduled marketplace maintenance failed.');}
}
