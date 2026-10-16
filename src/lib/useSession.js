import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient.js';

const SIGNED_OUT = Object.freeze({ session: null, user: null, loading: false });

/**
 * Tracks the Supabase session for header/navigation state.
 * Returns { session, user, loading }. When Supabase is not configured there is no
 * account service, so the app is treated as permanently signed out.
 */
export function useSession() {
  const [state, setState] = useState(() => (supabase
    ? { session: null, user: null, loading: true }
    : SIGNED_OUT));

  useEffect(() => {
    if (!supabase) {
      setState(SIGNED_OUT);
      return undefined;
    }
    let active = true;
    const apply = (session) => {
      if (!active) return;
      setState({ session: session ?? null, user: session?.user ?? null, loading: false });
    };
    // Read the stored session first, then follow the client's auth events. The callback
    // stays synchronous: awaiting other Supabase calls inside it can deadlock the client.
    supabase.auth.getSession()
      .then(({ data, error }) => apply(error ? null : data?.session))
      .catch(() => apply(null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => apply(session));
    return () => {
      active = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  return state;
}

/**
 * True only when the signed-in user holds the 'admin' role. Used to decide whether the
 * header shows a link to /admin-dashboard; it is not an access control. Every /api/admin/*
 * route re-checks the role on the server, and the row this reads is the caller's own
 * user_roles row, which the roles_read_self_or_admin policy already allows.
 */
export function useIsAdmin(session) {
  const userId = session?.user?.id ?? '';
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!supabase || !userId) {
      setIsAdmin(false);
      return undefined;
    }
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
        if (active) setIsAdmin(!error && data?.role === 'admin');
      } catch {
        if (active) setIsAdmin(false);
      }
    })();
    return () => { active = false; };
  }, [userId]);

  return isAdmin;
}
