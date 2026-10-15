import { requireRole, requireUser } from './_lib/supabase.js';
import { methodNotAllowed, sendError } from './_lib/http.js';

export default async function handler(req,res){
  if(req.method!=='GET') return methodNotAllowed(res,['GET']);
  try{
    const {userClient,user}=await requireUser(req);
    const role=String(req.query.role||'creator');
    if(!['creator','host','admin'].includes(role)) return res.status(400).json({error:'Unknown dashboard role.'});
    await requireRole(userClient,user.id,role);
    const payload=role==='creator'?await creatorSummary(userClient,user.id):role==='host'?await hostSummary(userClient,user.id):await adminSummary(userClient);
    res.setHeader('Cache-Control','no-store, private');
    return res.status(200).json({role,...payload});
  }catch(error){return sendError(res,error,'Dashboard data could not be loaded.');}
}

async function creatorSummary(client,userId){
  const now=new Date().toISOString();
  const [bookings,favorites,unread]=await Promise.all([
    client.from('bookings').select('id,public_code,listing_id,listing_title_snapshot,listing_city_snapshot,listing_neighbourhood_snapshot,starts_at,ends_at,booking_status,payment_status,payout_status,total_amount_kobo,creator_fee_kobo').eq('creator_id',userId).order('starts_at',{ascending:true}).limit(100),
    client.from('favorites').select('listing_id,created_at').eq('creator_id',userId).order('created_at',{ascending:false}).limit(100),
    client.from('notifications').select('id',{count:'exact',head:true}).eq('recipient_id',userId).is('read_at',null),
  ]);
  for(const result of [bookings,favorites,unread]) if(result.error) throw result.error;
  const rows=bookings.data||[];
  return {
    metrics:{
      upcomingBookings:rows.filter((item)=>item.starts_at>=now&&!['cancelled','declined','expired'].includes(item.booking_status)).length,
      pastBookings:rows.filter((item)=>item.ends_at<now).length,
      savedSpaces:(favorites.data||[]).length,
      unreadNotifications:unread.count||0,
    },
    bookings:rows,
    favoriteListingIds:(favorites.data||[]).map((item)=>item.listing_id),
  };
}

async function hostSummary(client,userId){
  const now=new Date().toISOString();
  const [bookings,listings,payouts,profile]=await Promise.all([
    client.from('bookings').select('id,public_code,listing_id,listing_title_snapshot,listing_city_snapshot,listing_neighbourhood_snapshot,starts_at,ends_at,booking_status,payment_status,payout_status,crew_size,production_type,host_share_kobo_snapshot,total_amount_kobo').eq('host_id',userId).order('starts_at',{ascending:true}).limit(150),
    client.from('listings').select('id,slug,title,status,city,neighbourhood,hourly_rate_kobo').eq('owner_id',userId).order('created_at',{ascending:false}).limit(100),
    client.from('payouts').select('amount_kobo,status').eq('host_id',userId).limit(1000),
    client.from('host_profiles').select('public_display_name,verification_status,review_reason').eq('user_id',userId).maybeSingle(),
  ]);
  for(const result of [bookings,listings,payouts,profile]) if(result.error) throw result.error;
  const sessions=bookings.data||[];
  const payoutRows=payouts.data||[];
  const livePaidStatuses=new Set(['confirmed','checked_in','completion_pending','completed','disputed']);
  const livePaidSessions=sessions.filter((item)=>item.payment_status==='paid'&&livePaidStatuses.has(item.booking_status));
  return {
    metrics:{
      hostShareKobo:sumKobo(livePaidSessions,(item)=>item.host_share_kobo_snapshot),
      paidOutKobo:sumKobo(payoutRows.filter((item)=>item.status==='paid'),(item)=>item.amount_kobo),
      payoutHeldKobo:sumKobo(livePaidSessions.filter((item)=>item.payout_status==='held'),(item)=>item.host_share_kobo_snapshot),
      payoutEligibleKobo:sumKobo(livePaidSessions.filter((item)=>item.payout_status==='eligible'),(item)=>item.host_share_kobo_snapshot),
      upcomingBookings:sessions.filter((item)=>item.starts_at>=now&&!['cancelled','declined','expired'].includes(item.booking_status)).length,
      completedShoots:sessions.filter((item)=>item.booking_status==='completed').length,
      listings:(listings.data||[]).length,
    },
    bookings:sessions,
    listings:listings.data||[],
    host:profile.data||null,
  };
}

function sumKobo(rows,getValue){
  return rows.reduce((sum,item)=>sum+BigInt(getValue(item)||0),0n).toString();
}

async function adminSummary(client){
  const [listings,hosts,bookings,payments,disputes,payouts,contacts]=await Promise.all([
    client.from('listings').select('id,title,slug,owner_id,status,city,neighbourhood,created_at').eq('status','submitted').order('submitted_at',{ascending:true}).limit(100),
    client.from('host_profiles').select('user_id,public_display_name,verification_status,created_at').eq('verification_status','pending').order('created_at',{ascending:true}).limit(100),
    client.from('bookings').select('id,public_code,booking_status,payment_status,payout_status,total_amount_kobo,commission_kobo_snapshot,creator_fee_kobo,starts_at,ends_at,listing_title_snapshot,host_share_kobo_snapshot').order('created_at',{ascending:false}).limit(1000),
    client.from('payments').select('id,booking_id,provider_reference,status,amount_kobo,verified_at').order('created_at',{ascending:false}).limit(1000),
    client.from('disputes').select('id,booking_id,opened_by,dispute_type,description,status,created_at,refund_amount_kobo').order('created_at',{ascending:false}).limit(100),
    client.from('payouts').select('id,booking_id,host_id,amount_kobo,status').order('created_at',{ascending:false}).limit(1000),
    client.from('contact_requests').select('id,full_name,email,phone,subject,message,status,created_at').order('created_at',{ascending:false}).limit(100),
  ]);
  for(const result of [listings,hosts,bookings,payments,disputes,payouts,contacts]) if(result.error) throw result.error;
  const bookingRows=bookings.data||[];
  const paymentRows=payments.data||[];
  const payoutRows=payouts.data||[];
  const bookingById=new Map(bookingRows.map((item)=>[item.id,item]));
  const disputeRows=(disputes.data||[]).map((item)=>({...item,total_amount_kobo:bookingById.get(item.booking_id)?.total_amount_kobo||'0'}));
  const livePaidStatuses=new Set(['confirmed','checked_in','completion_pending','completed','disputed']);
  return {
    metrics:{
      listingReviewQueue:(listings.data||[]).length,
      hostReviewQueue:(hosts.data||[]).length,
      bookings:bookingRows.length,
      capturedPaymentsKobo:sumKobo(paymentRows.filter((item)=>item.status==='paid'),(item)=>item.amount_kobo),
      commissionKobo:sumKobo(bookingRows.filter((item)=>item.payment_status==='paid'&&livePaidStatuses.has(item.booking_status)),(item)=>item.commission_kobo_snapshot),
      latePaidBookings:bookingRows.filter((item)=>item.payment_status==='paid'&&!livePaidStatuses.has(item.booking_status)).length,
      openDisputes:disputeRows.filter((item)=>!['resolved','closed'].includes(item.status)).length,
      payoutHeld:bookingRows.filter((item)=>item.payout_status==='held'&&item.payment_status==='paid'&&livePaidStatuses.has(item.booking_status)).length,
      payoutsProcessing:payoutRows.filter((item)=>['eligible','queued','processing'].includes(item.status)).length,
      contactQueue:(contacts.data||[]).filter((item)=>item.status==='new').length,
    },
    queues:{listings:listings.data||[],hosts:hosts.data||[],disputes:disputeRows,payments:paymentRows,bookings:bookingRows,contacts:contacts.data||[],payouts:payoutRows},
  };
}
