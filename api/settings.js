import { getAnonymousClient } from './_lib/supabase.js';
import { methodNotAllowed, sendError } from './_lib/http.js';

export default async function handler(req,res){
  if(req.method!=='GET') return methodNotAllowed(res,['GET']);
  try{
    const {data,error}=await getAnonymousClient().from('public_platform_settings').select('*').maybeSingle();
    if(error) throw error;
    if(!data) return res.status(503).json({error:'Platform settings are not available.'});
    const paymentRuntimeReady=process.env.PAYMENT_ENABLED==='true'&&process.env.PAYMENT_PROVIDER==='paystack'&&Boolean(process.env.PAYSTACK_SECRET_KEY)&&Boolean(process.env.PAYMENT_RETURN_URL);
    res.setHeader('Cache-Control','public, s-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({
      bookingEnabled:Boolean(data.booking_enabled&&data.cancellation_policy_approved),
      paymentEnabled:Boolean(data.payment_enabled&&data.booking_enabled&&data.cancellation_policy_approved&&paymentRuntimeReady),
      cancellationPolicyApproved:Boolean(data.cancellation_policy_approved),
      cancellationPolicyVersion:data.cancellation_policy_version,
      cancellationPolicyText:data.cancellation_policy_text,
      requestExpiryMinutes:data.request_expiry_minutes,
      paymentWindowMinutes:data.payment_window_minutes,
      otpTtlMinutes:data.otp_ttl_minutes,
      otpWindowBeforeMinutes:data.otp_window_before_minutes,
      otpWindowAfterMinutes:data.otp_window_after_minutes,
      payoutDelayHours:data.payout_delay_hours,
      commissionBps:Number(data.commission_bps),
      creatorFeeBps:data.creator_fee_approved?Number(data.creator_fee_bps):0,
      creatorFeeApproved:Boolean(data.creator_fee_approved),
    });
  }catch(error){return sendError(res,error,'Platform settings could not be loaded.');}
}
