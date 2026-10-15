import { supabase } from './supabaseClient.js';

export async function apiFetch(path,options={}){
  const headers=new Headers(options.headers||{});
  headers.set('Accept','application/json');
  if(options.body!==undefined&&!headers.has('Content-Type')) headers.set('Content-Type','application/json');
  const {data:{session}}=supabase?await supabase.auth.getSession():{data:{session:null}};
  if(session?.access_token) headers.set('Authorization',`Bearer ${session.access_token}`);
  const response=await fetch(path,{...options,headers,body:options.body===undefined?undefined:typeof options.body==='string'?options.body:JSON.stringify(options.body)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(result.error||`Request failed (${response.status}).`);
  return result;
}

export function makeIdempotencyKey(){
  if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes=globalThis.crypto?.getRandomValues?.(new Uint8Array(16));
  if(!bytes) throw new Error('This browser cannot create a secure request key.');
  bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=Array.from(bytes,(value)=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function localDateAtLagos(date,time){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time)) throw new Error('Choose a valid date and start time.');
  const value=new Date(`${date}T${time}:00+01:00`);
  if(!Number.isFinite(value.valueOf())) throw new Error('Choose a valid date and start time.');
  return value.toISOString();
}
