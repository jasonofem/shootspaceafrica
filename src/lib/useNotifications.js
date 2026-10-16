import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient.js';

/**
 * Notifications for the signed-in user, read straight from the browser.
 *
 * The `notifications` table already allows a signed-in user to read their own rows
 * (`notifications_owner_read_update`) and to update them (`notifications_owner_update`), so no
 * API function is involved — the site is on a Vercel plan with a hard 12-function limit and this
 * must not add one. Every query below filters by `recipient_id` in addition to the database
 * policy, so another user's rows can never appear.
 *
 * When the unread count is refreshed:
 *   - once on page load,
 *   - when the tab becomes visible again,
 *   - every 60 seconds,
 *   - and after marking anything as read (resynced from the database).
 */

export const LIST_LIMIT = 50;
export const REFRESH_INTERVAL_MS = 60000;

// Only the columns the panel renders: never the payload JSON.
const LIST_COLUMNS = 'id,event_type,created_at,read_at';
const COUNT_COLUMNS = 'id';

// Postgres privileges error. Reading notifications is granted, updating is a separate grant that
// the owner applies once (see README); until then marking fails and must say so plainly.
const PERMISSION_DENIED = '42501';

const EMPTY_STATE = Object.freeze({ items: [], unreadCount: 0, ready: false, loadingList: false, error: '' });
const LOAD_FAILED = 'Notifications could not be loaded.';

/** Plain-language message when a mark-as-read write is rejected. */
export function notificationActionMessage(error) {
  if (error?.code === PERMISSION_DENIED) return 'Marking as read is not switched on yet. Please tell the site owner.';
  return 'Notifications could not be updated. Please try again.';
}

export function useNotifications(session) {
  const userId = session?.user?.id ?? '';
  const [state, setState] = useState(EMPTY_STATE);
  const [panelOpen, setPanelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  // The header stays mounted while the session changes, so a reply that arrives after a sign-out
  // or an account switch must be thrown away instead of updating the wrong person's badge.
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  const fetchUnreadCount = useCallback(async () => {
    const requestedFor = userId;
    if (!supabase || !requestedFor) return;
    const { count, error } = await supabase.from('notifications')
      .select(COUNT_COLUMNS, { count: 'exact', head: true })
      .eq('recipient_id', requestedFor)
      .is('read_at', null);
    if (userIdRef.current !== requestedFor) return;
    setState((current) => (error
      ? { ...current, ready: true, error: LOAD_FAILED }
      : { ...current, ready: true, error: '', unreadCount: Math.max(0, Number(count) || 0) }));
  }, [userId]);

  const fetchList = useCallback(async () => {
    const requestedFor = userId;
    if (!supabase || !requestedFor) return;
    setState((current) => ({ ...current, loadingList: true }));
    const { data, error } = await supabase.from('notifications')
      .select(LIST_COLUMNS)
      .eq('recipient_id', requestedFor)
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT);
    if (userIdRef.current !== requestedFor) return;
    setState((current) => (error
      ? { ...current, ready: true, loadingList: false, error: LOAD_FAILED }
      : { ...current, ready: true, loadingList: false, error: '', items: Array.isArray(data) ? data : [] }));
  }, [userId]);

  // Sign-out and account switches start from a clean panel and a clean badge.
  useEffect(() => {
    setState(EMPTY_STATE);
    setPanelOpen(false);
    setBusy(false);
    setActionError('');
  }, [userId]);

  // Page load, return to the tab, and the 60-second safety refresh all share one call.
  useEffect(() => {
    if (!supabase || !userId) return undefined;
    let cancelled = false;
    const run = () => { if (!cancelled && document.visibilityState !== 'hidden') void fetchUnreadCount(); };
    run();
    const timer = window.setInterval(run, REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [userId, fetchUnreadCount]);

  // The list is only fetched when it is actually needed.
  useEffect(() => {
    if (!panelOpen || !supabase || !userId) return;
    void fetchList();
  }, [panelOpen, userId, fetchList]);

  const openPanel = useCallback(() => { setActionError(''); setPanelOpen(true); }, []);
  const closePanel = useCallback(() => setPanelOpen(false), []);
  const togglePanel = useCallback(() => { setActionError(''); setPanelOpen((value) => !value); }, []);

  const refresh = useCallback(() => {
    void fetchUnreadCount();
    if (panelOpen) void fetchList();
  }, [panelOpen, fetchList, fetchUnreadCount]);

  /** Mark one notification read. The badge drops immediately, before the database reply. */
  const markRead = useCallback(async (id) => {
    const requestedFor = userId;
    if (!supabase || !requestedFor || !id) return false;
    setActionError('');
    setBusy(true);
    const readAt = new Date().toISOString();
    let wasUnread = false;
    setState((current) => {
      wasUnread = current.items.some((item) => item.id === id && !item.read_at);
      if (!wasUnread) return current;
      return {
        ...current,
        items: current.items.map((item) => (item.id === id ? { ...item, read_at: readAt } : item)),
        unreadCount: Math.max(0, current.unreadCount - 1),
      };
    });
    // The filters repeat the database policy: own row, still unread, and nothing else.
    const { error } = await supabase.from('notifications')
      .update({ read_at: readAt })
      .eq('id', id)
      .eq('recipient_id', requestedFor)
      .is('read_at', null);
    if (userIdRef.current !== requestedFor) return false;
    setBusy(false);
    if (error) {
      setActionError(notificationActionMessage(error));
      // Resync so the badge never keeps a number the database did not accept.
      void fetchUnreadCount();
      void fetchList();
      return false;
    }
    return true;
  }, [userId, fetchList, fetchUnreadCount]);

  /** Mark every unread notification of this user read, including ones past the list limit. */
  const markAllRead = useCallback(async () => {
    const requestedFor = userId;
    if (!supabase || !requestedFor) return false;
    setActionError('');
    setBusy(true);
    const readAt = new Date().toISOString();
    setState((current) => ({
      ...current,
      items: current.items.map((item) => (item.read_at ? item : { ...item, read_at: readAt })),
      unreadCount: 0,
    }));
    const { error } = await supabase.from('notifications')
      .update({ read_at: readAt })
      .eq('recipient_id', requestedFor)
      .is('read_at', null);
    if (userIdRef.current !== requestedFor) return false;
    setBusy(false);
    if (error) {
      setActionError(notificationActionMessage(error));
      void fetchUnreadCount();
      void fetchList();
      return false;
    }
    return true;
  }, [userId, fetchList, fetchUnreadCount]);

  return {
    items: state.items,
    unreadCount: state.unreadCount,
    ready: state.ready,
    loadingList: state.loadingList,
    error: state.error,
    panelOpen,
    busy,
    actionError,
    openPanel,
    closePanel,
    togglePanel,
    refresh,
    markRead,
    markAllRead,
  };
}
