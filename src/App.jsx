import { Component, createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, BadgeCheck, Banknote, Bell, CalendarDays, Camera, Check, CheckCircle2,
  ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Copy,
  FileImage, Filter, Heart, KeyRound, Mail, MapPin, Menu, MessageSquare, Phone,
  Search, Shield, ShieldCheck, SlidersHorizontal, Star, Upload, Wallet, X,
} from 'lucide-react';
import {
  BrowserRouter, Link, Route, Routes, useLocation, useNavigate, useParams, useSearchParams,
} from 'react-router-dom';
import { amenityLabels, categories, faqs, money } from './data.js';
import { apiFetch, localDateAtLagos, makeIdempotencyKey } from './lib/api.js';
import { publicSettings } from './config.js';
import { supabase } from './lib/supabaseClient.js';
import { useIsAdmin, useHostProfile, useSession } from './lib/useSession.js';
import { usePublicListings } from './hooks/usePublicListings.js';
import { useNotifications } from './lib/useNotifications.js';
import { formatUnreadCount, notificationBellLabel, notificationTime, notificationTitle } from './lib/notifications.js';
import { assessTimeSlot, calculateBookingBaseKobo, parseNairaToKobo } from './lib/businessRules.js';

const ToastContext = createContext(() => {});
// Base price = rate per person per hour x hours x crew. Returns 0 for unusable inputs (e.g. sample data) instead of crashing the page.
function bookingBaseKobo(rateKobo,hours,crew){try{return calculateBookingBaseKobo({hourlyRateKobo:rateKobo,hours,crewSize:crew});}catch{return 0n;}}
const BOOKING_KEY = 'shootspace.booking-draft';
const NO_FILTERS = Object.freeze({});

function readLocal(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}
function readSession(key, fallback = null) {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}
function futureDate(days = 7) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
}
function dateTime(value) {
  if (!value) return 'Date not provided';
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return 'Date not provided';
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(date);
}
function dateOnly(value) {
  if (!value) return 'Date not provided';
  const date = new Date(`${value.slice(0, 10)}T12:00:00+01:00`);
  return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' }).format(date) : 'Date not provided';
}
function displayStatus(value = '') {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function statusClass(value = '') {
  if (['confirmed', 'completed', 'approved', 'paid', 'eligible', 'published'].includes(value)) return 'badge-green';
  if (['request_pending', 'accepted_awaiting_payment', 'payment_pending', 'pending', 'held', 'completion_pending', 'submitted'].includes(value)) return 'badge-yellow';
  if (['declined', 'cancelled', 'expired', 'rejected', 'failed', 'disputed', 'suspended'].includes(value)) return 'badge-red';
  return 'badge-neutral';
}

// Redacts anything token-shaped before an error message is shown on screen.
function safeErrorText(value) {
  const text = String(value?.message || value || 'Unexpected error');
  return text
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}

// Shows a readable message instead of a blank page when any route crashes while rendering.
class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error('Page render failed:', error);
  }
  render() {
    if (this.state.error) {
      return <div className="page-wrap wrap"><div className="panel error-boundary-panel" role="alert">
        <p className="eyebrow">Something went wrong</p>
        <h1>This page could not finish loading</h1>
        <p>The message below is shown so this can be reported and fixed. It never includes passwords or secret keys.</p>
        <pre className="error-detail">{safeErrorText(this.state.error)}</pre>
        <div className="button-row"><button type="button" className="button button-primary" onClick={() => window.location.reload()}>Reload page</button><Link className="button button-secondary" to="/">Back to home</Link></div>
      </div></div>;
    }
    return this.props.children;
  }
}
function RouteErrorBoundary({ children }) {
  const location = useLocation();
  return <AppErrorBoundary key={location.pathname}>{children}</AppErrorBoundary>;
}

function App() {
  const [toast, setToast] = useState('');
  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);
  return <ToastContext.Provider value={setToast}>
    <BrowserRouter>
      <RouteErrorBoundary>
      <Routes>
        <Route path="/" element={<SiteLayout><HomePage /></SiteLayout>} />
        <Route path="/explore" element={<SiteLayout><ExplorePage /></SiteLayout>} />
        <Route path="/spaces/:spaceId" element={<SiteLayout><SpaceDetailsPage /></SiteLayout>} />
        <Route path="/signin" element={<SiteLayout><AuthPage /></SiteLayout>} />
        <Route path="/signup" element={<SiteLayout><AuthPage isRegister /></SiteLayout>} />
        <Route path="/checkout" element={<SiteLayout><CheckoutPage /></SiteLayout>} />
        <Route path="/booking-confirmed" element={<SiteLayout><BookingConfirmedPage /></SiteLayout>} />
        <Route path="/creator-dashboard" element={<SiteLayout><CreatorDashboard /></SiteLayout>} />
        <Route path="/host-dashboard" element={<SiteLayout><HostDashboard /></SiteLayout>} />
        <Route path="/admin-dashboard" element={<SiteLayout><AdminDashboard /></SiteLayout>} />
        <Route path="/host/onboarding" element={<SiteLayout><HostOnboarding /></SiteLayout>} />
        <Route path="/host/listings/new" element={<SiteLayout><HostOnboarding mode="new-listing" /></SiteLayout>} />
        <Route path="/otp-room" element={<SiteLayout><OtpRoomPage /></SiteLayout>} />
        <Route path="/contact" element={<SiteLayout><ContactPage /></SiteLayout>} />
        <Route path="/dispute" element={<SiteLayout><DisputePage /></SiteLayout>} />
        <Route path="/terms" element={<SiteLayout><PolicyPage kind="terms" /></SiteLayout>} />
        <Route path="/privacy" element={<SiteLayout><PolicyPage kind="privacy" /></SiteLayout>} />
        <Route path="/cancellation" element={<SiteLayout><PolicyPage kind="cancellation" /></SiteLayout>} />
        <Route path="*" element={<SiteLayout><NotFound /></SiteLayout>} />
      </Routes>
      </RouteErrorBoundary>
    </BrowserRouter>
    {toast && <div className="toast" role="status"><CheckCircle2 size={17} />{toast}</div>}
  </ToastContext.Provider>;
}
function useToast() { return useContext(ToastContext); }

function SiteLayout({ children }) {
  return <div className="app-shell"><Header /><main>{children}</main><Footer /></div>;
}
function BrandMark() {
  return <img className="brand-mark" src="/images/shootspace-mark.svg" alt="" aria-hidden="true" draggable="false"/>;
}
export function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { session, loading } = useSession();
  const isAdmin = useIsAdmin(session);
  const { isHost, checking: hostChecking } = useHostProfile(session);
  const notifications = useNotifications(session);
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => { notifications.closePanel(); }, [location.pathname]);
  // Until the stored session is read, neither the signed-out nor the signed-in buttons are
  // rendered, so "Sign In"/"Get Started" never flash for a signed-in user.
  const signedIn = Boolean(session);
  const showAccountControls = !loading;
  // Hosts get a way back to /host-dashboard instead of the "Become a Host" application link.
  // The slot waits for the one-per-page-load host check so a host is never shown the
  // application link first. Non-hosts keep "Become a Host" exactly as before.
  const showHostNav = !loading && !hostChecking;
  const showBell = showAccountControls && signedIn;
  // Escape or a click outside closes the notification panel. The panel is a dropdown, not a route.
  useEffect(() => {
    if (!notifications.panelOpen) return undefined;
    const onPointerDown = (event) => {
      if (event.target?.closest?.('.notifications-panel, [data-notification-toggle]')) return;
      notifications.closePanel();
    };
    const onKeyDown = (event) => { if (event.key === 'Escape') notifications.closePanel(); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [notifications.panelOpen, notifications.closePanel]);
  const toggleNotifications = () => { setOpen(false); notifications.togglePanel(); };
  const signOut = async () => {
    if (!supabase || signingOut) return;
    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      toast('Signed out.');
      setOpen(false);
      navigate('/');
    } catch (error) {
      toast(error?.message ? `Sign out failed: ${error.message}` : 'Sign out failed. Please try again.');
    } finally {
      setSigningOut(false);
    }
  };
  return <header className="site-header"><div className="header-inner">
    <Link to="/" className="brand" aria-label="ShootSpace Africa home"><BrandMark /></Link>
    <nav className="desktop-nav" aria-label="Main navigation"><Link to="/explore">Explore</Link>{showHostNav && (isHost ? <Link to="/host-dashboard">Host dashboard</Link> : <Link to="/host/onboarding">Become a Host</Link>)}<a href="/#how-it-works">How It Works</a>
      {showAccountControls && (signedIn ? <><Link to="/creator-dashboard">Dashboard</Link>{isAdmin && <Link to="/admin-dashboard">Admin</Link>}</> : <Link to="/signin">Sign In</Link>)}
    </nav>
    <div className="header-actions">{showAccountControls && (signedIn
      ? <><NotificationBell notifications={notifications} onToggle={toggleNotifications} /><button type="button" className="button button-secondary button-small" onClick={signOut} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button></>
      : <Link className="button button-primary button-small" to="/signup">Get Started</Link>)}</div>
    <div className="header-mobile-actions">{showBell && <NotificationBell notifications={notifications} onToggle={toggleNotifications} />}
      <button type="button" className="mobile-menu-button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => { notifications.closePanel(); setOpen((value) => !value); }}>{open ? <X size={22} /> : <Menu size={22} />}</button>
    </div>
  </div>{notifications.panelOpen && <NotificationsPanel notifications={notifications} />}{open && <nav className="mobile-nav" aria-label="Mobile navigation"><Link to="/explore">Explore spaces</Link>{showHostNav && (isHost ? <Link to="/host-dashboard">Host dashboard</Link> : <Link to="/host/onboarding">Become a host</Link>)}<a href="/#how-it-works">How it works</a>
    {showAccountControls && (signedIn
      ? <><Link to="/creator-dashboard">Dashboard</Link>{isAdmin && <Link to="/admin-dashboard">Admin</Link>}<button type="button" className="button button-secondary" onClick={signOut} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button></>
      : <><Link to="/signin">Sign in</Link><Link className="button button-primary" to="/signup">Get Started</Link></>)}
  </nav>}</header>;
}
/**
 * The notifications bell. Shown in the desktop header next to Sign out and in the mobile top bar.
 * Both copies drive the same panel, so the count never differs between them.
 */
function NotificationBell({ notifications, onToggle }) {
  const badge = formatUnreadCount(notifications.unreadCount);
  return <button type="button" data-notification-toggle className={`notification-bell${badge ? ' is-unread' : ''}`}
    aria-label={notificationBellLabel(notifications.unreadCount)} aria-haspopup="true" aria-expanded={notifications.panelOpen}
    aria-controls="notifications-panel" onClick={onToggle}>
    <Bell size={18} aria-hidden="true" />
    {badge && <span className="notification-badge" aria-hidden="true">{badge}</span>}
  </button>;
}
function NotificationsPanel({ notifications }) {
  const { items, unreadCount, loadingList, error, busy, actionError, markRead, markAllRead, closePanel, refresh } = notifications;
  const newestFirst = [...items].sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));
  return <section className="notifications-panel" id="notifications-panel" role="region" aria-label="Notifications">
    <div className="notifications-head"><h2>Notifications</h2><div className="notifications-head-actions">
      <button type="button" className="text-link" onClick={markAllRead} disabled={busy || unreadCount === 0}>Mark all as read</button>
      <button type="button" className="notification-close" aria-label="Close notifications" onClick={closePanel}><X size={16} /></button>
    </div></div>
    {actionError && <p className="form-error" role="alert">{actionError}</p>}
    {loadingList && !newestFirst.length ? <p className="notification-empty" role="status"><span className="loading-dot" />Loading notifications…</p>
      : error && !newestFirst.length ? <div className="notification-empty"><p>{error}</p><button type="button" className="text-link" onClick={refresh}>Try again</button></div>
      : !newestFirst.length ? <p className="notification-empty">No notifications yet.</p>
      : <ul className="notification-list">{newestFirst.map((item) => {
        const title = notificationTitle(item.event_type);
        const time = notificationTime(item.created_at);
        if (item.read_at) return <li key={item.id}><div className="notification-item is-read"><span className="notification-item-title">{title}</span><small>{time}</small></div></li>;
        return <li key={item.id}><button type="button" className="notification-item is-unread" disabled={busy} onClick={() => markRead(item.id)} aria-label={`${title}. ${time}. Mark as read.`}><span className="notification-item-title">{title}</span><small>{time}</small></button></li>;
      })}</ul>}
    {Boolean(newestFirst.length) && !loadingList && <p className="notifications-foot">Opening a notification marks it as read. Booking, payment and review updates appear here.</p>}
  </section>;
}
function Footer() {
  return <footer className="site-footer"><div className="footer-grid wrap">
    <div className="footer-brand-block"><Link to="/" className="brand footer-brand"><BrandMark /><span>ShootSpace Africa</span></Link><p>A marketplace workflow for production-location requests, review and booking operations.</p><p className="draft-label">Policies are drafts and need owner/legal review.</p></div>
    <div><h4>Explore</h4><Link to="/explore">Find a space</Link><Link to="/host/onboarding">Submit a location</Link><a href="/#how-it-works">How it works</a></div>
    <div><h4>Support</h4><Link to="/contact">Contact</Link><Link to="/dispute">Dispute centre</Link><Link to="/privacy">Privacy draft</Link></div>
    <div><h4>Account</h4><Link to="/creator-dashboard">Creator dashboard</Link><Link to="/host-dashboard">Host dashboard</Link><Link to="/admin-dashboard">Admin operations</Link><Link to="/terms">Terms draft</Link><Link to="/cancellation">Cancellation draft</Link></div>
  </div><div className="footer-bottom wrap"><span>© 2026 ShootSpace Africa</span><span>Live inventory and operations depend on owner configuration.</span></div></footer>;
}

function HomePage() {
  const navigate = useNavigate();
  const listings = usePublicListings(NO_FILTERS);
  const [search, setSearch] = useState({ location: '', category: '', date: '', crew: '4' });
  const [heroSettings, setHeroSettings] = useState(null);
  useEffect(() => { apiFetch('/api/settings').then(setHeroSettings).catch(() => setHeroSettings(null)); }, []);
  const doSearch = (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (search.location.trim()) params.set('location', search.location.trim());
    if (search.category) params.set('category', search.category);
    if (search.date) params.set('date', search.date);
    if (search.crew) params.set('crew', String(Math.max(1, Math.min(500, Number(search.crew) || 1))));
    try { sessionStorage.setItem('shootspace.discovery-preferences', JSON.stringify({ date: search.date, crew: Number(search.crew) || 1 })); } catch { /* Preferences are optional. */ }
    navigate(`/explore${params.size ? `?${params}` : ''}`);
  };
  const samplePreview = listings.sample;
  const howItWorks = [
    ['01','Find a location','Browse published listings and review the host-provided details and opening hours.'],
    ['02','Request by the hour','Choose a time and crew size. Availability is checked again by the server.'],
    ['03','Host responds','A host accepts or declines. A request by itself is not a confirmed booking.'],
    ['04','Payment, if enabled','Pay only after acceptance. A signed provider event—not a browser redirect—confirms payment.'],
    ['05','Check in','A booking-specific one-time code is available only inside the configured check-in window.'],
    ['06','Completion & payout review','Completion, disputes and payout eligibility are separate. Check-in never releases a payout.'],
  ];
  const reasons = [
    'Public discovery uses approved database records',
    'No fabricated reviews or dashboard figures',
    'Host availability is checked again on request',
    'Exact arrival details stay private to participants',
    'Booking, payment and payout have separate states',
    'Disputes keep payout on hold for review',
  ];
  return <>
    <section className="hero"><div className="hero-art" aria-hidden="true" /><div className="hero-content wrap">
      <p className="eyebrow">Nigeria’s production-location marketplace</p>
      <h1>ShootSpace Africa</h1>
      <h2 className="hero-subtitle">Find Film and Photo Shoot Locations Across Nigeria.</h2>
      <p className="hero-copy">Discover production-ready spaces by the hour. Review host-listed amenities and published opening hours, then send a request. A request is not a confirmed booking; {heroSettings?.paymentEnabled?'payment settings are enabled, and provider confirmation is still required.':'payment features remain disabled until the owner configures them.'}</p>
      <div className="hero-ctas"><Link to="/explore" className="button button-primary">Explore locations <ArrowRight size={16}/></Link><Link to="/host/onboarding" className="button button-ghost">List Your Space</Link></div>
      <form className="hero-search" onSubmit={doSearch}>
        <label className="search-field"><MapPin size={16}/><span className="sr-only">Location</span><input value={search.location} onChange={(event)=>setSearch({...search,location:event.target.value})} placeholder="City or neighbourhood" aria-label="Location"/></label>
        <label className="search-field"><Camera size={16}/><span className="sr-only">Production type</span><select value={search.category} onChange={(event)=>setSearch({...search,category:event.target.value})} aria-label="Production type"><option value="">All spaces</option>{categories.map((item)=><option key={item}>{item}</option>)}</select></label>
        <label className="search-field search-date"><CalendarDays size={16}/><span className="sr-only">Shoot date</span><input type="date" min={futureDate(0)} value={search.date} onChange={(event)=>setSearch({...search,date:event.target.value})} aria-label="Shoot date"/></label>
        <label className="search-field search-crew"><span className="sr-only">Crew size</span><select value={search.crew} onChange={(event)=>setSearch({...search,crew:event.target.value})} aria-label="Crew size">{[1,2,3,4,5,6,8,10,12,15,20,30].map((value)=><option key={value} value={value}>{value} crew</option>)}</select></label>
        <button className="button button-primary search-submit" type="submit"><Search size={16}/><span>Search</span></button>
      </form>
    </div><p className="hero-image-note">Illustrative image · not a listed property</p></section>
    <div className="trust-strip"><div className="wrap trust-items"><TrustItem icon={BadgeCheck} text={samplePreview?'Development samples · not real listings':'Approved listings only'}/><TrustItem icon={CalendarDays} text={samplePreview?'Samples cannot be booked':'Availability rechecked on request'}/><TrustItem icon={MessageSquare} text={samplePreview?'No live booking requests':'Request before confirmation'}/><TrustItem icon={Shield} text={heroSettings?.paymentEnabled?'Payment settings enabled':'Payments not enabled yet'}/><TrustItem icon={KeyRound} text="Check-in flow when configured"/></div></div>
    {samplePreview && <SampleNotice />}
    <section className="section wrap category-section"><SectionHeading title="Featured Categories" subtitle="Choose a production type to filter live published locations."/><div className="category-pills">{categories.map((category)=><Link className="category-pill" key={category} to={`/explore?category=${encodeURIComponent(category)}`}>{category}</Link>)}</div></section>
    <section className="section wrap"><SectionHeading title="Featured Locations" subtitle={listings.sample?'Fictional development fixtures for layout preview only; these are not real or bookable locations.':listings.loading?'Checking approved database inventory…':listings.listings.length?'Published spaces submitted by hosts and reviewed before discovery.':'No locations are currently approved for public discovery.'} action={<Link className="text-link" to="/explore">View all locations <ArrowRight size={15}/></Link>}/><ListingCollection state={listings} compact /></section>
    <section className="section wrap" id="how-it-works"><SectionHeading title="How It Works" subtitle="A booking moves through separate, auditable states."/><div className="steps-grid">{howItWorks.map(([number,title,text])=><div className="step-card" key={number}><span className="step-number">STEP {number}</span><h3>{title}</h3><p>{text}</p></div>)}</div></section>
    <section className="section wrap"><SectionHeading title="Production Amenities" subtitle="These are filter categories only; each published listing shows its own submitted amenities."/><div className="amenity-grid">{amenityLabels.map((item)=><div className="amenity-tile" key={item}><CheckCircle2 size={16}/>{item}</div>)}</div></section>
    <section className="section wrap why-section"><SectionHeading title="Why ShootSpace" subtitle="Designed around clear status, privacy and owner review—not unverified marketplace claims."/><div className="why-grid">{reasons.map((reason)=><div className="why-item" key={reason}><span><Check size={14}/></span>{reason}</div>)}</div></section>
    <section className="section wrap commitments-section"><SectionHeading title="Made for the work behind the shot" subtitle="Practical details for planning a production day."/><div className="commitment-grid"><article className="commitment-card"><CalendarDays size={18}/><h3>Plan with the host’s hours</h3><p>Availability is visible where published, then checked again before a booking request is accepted.</p></article><article className="commitment-card"><ShieldCheck size={18}/><h3>Know each status</h3><p>Requests, provider-confirmed payments, completion, disputes and payout eligibility are distinct.</p></article><article className="commitment-card"><MapPin size={18}/><h3>Keep arrival details private</h3><p>The exact address is shared with booking participants only after server-verified payment.</p></article></div></section>
    <section className="host-cta wrap"><div><p className="eyebrow">For space owners</p><h2>Turn Your Property Into a Production Location</h2><p>Submit a real space for host and listing review. Submission does not publish it or make it bookable.</p></div><Link className="button button-primary" to="/host/onboarding">Become a Host <ArrowRight size={16}/></Link></section>
    <section className="section wrap faq-section" id="faq"><SectionHeading title="FAQ" subtitle="Answers about current setup and launch status."/><FaqList settings={heroSettings}/></section>
  </>;
}
function SampleNotice() { return <div className="sample-banner wrap" role="note"><span>Development preview</span> Fictional design samples are shown for development only. They are not available to book and are never used as production inventory.</div>; }
function TrustItem({icon:Icon,text}) { return <div className="trust-item"><Icon size={15}/><span>{text}</span></div>; }
function SectionHeading({title,subtitle,action}) { return <div className="section-heading"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{action}</div>; }
function ListingCollection({state,compact=false}) {
  if(state.loading) return <div className="empty-state"><span className="loading-dot"/><p>Loading approved locations…</p></div>;
  if(state.error) return <div className="empty-state"><CircleHelp size={24}/><h3>Locations are unavailable</h3><p>{state.error}</p><Link className="button button-secondary" to="/contact">Contact the owner</Link></div>;
  if(!state.listings.length) return <div className="empty-state"><CircleHelp size={24}/><h3>No published locations yet</h3><p>Approved listings will appear here once real host inventory is reviewed.</p><Link className="button button-secondary" to="/host/onboarding">Submit a location</Link></div>;
  return <><div className="spaces-grid featured-grid">{state.listings.slice(0,compact?6:state.listings.length).map((space)=><SpaceCard key={space.uuid||space.id} space={space}/>)}</div>{state.hasMore&&<p className="helper-text">More published locations are available through Explore.</p>}</>;
}
function SpaceCard({space}) {
  const toast=useToast();
  const navigate=useNavigate();
  const [saved,setSaved]=useState(false);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{
    let active=true;
    if(!space.uuid||space.isSample||!supabase) return undefined;
    supabase.auth.getUser().then(({data})=>{
      if(!active||!data.user) return;
      supabase.from('favorites').select('listing_id').eq('creator_id',data.user.id).eq('listing_id',space.uuid).maybeSingle().then(({data:favorite})=>{if(active&&favorite)setSaved(true);});
    });
    return ()=>{active=false;};
  },[space.uuid,space.isSample]);
  const toggleSaved=async()=>{
    if(space.isSample||!space.uuid) return;
    setSaving(true);
    try{await apiFetch('/api/favorites',{method:saved?'DELETE':'POST',body:{listingId:space.uuid}});setSaved(!saved);}
    catch(error){if(error.message.includes('authentication')) navigate('/signin?next=/explore');else toast(error.message);}
    finally{setSaving(false);}
  };
  return <article className={`space-card${space.isSample?' is-sample':''}`}>
    <Link to={`/spaces/${space.id}`} className="space-card-image" aria-label={`View ${space.name}`}><img src={space.image} alt={space.name} loading="lazy"/>{space.verified&&<span className="verified-label"><CheckCircle2 size={12}/> Admin reviewed</span>}{space.isSample&&<span className="sample-card-label">DEV PREVIEW</span>}</Link>
    <div className="space-card-body"><div className="space-card-title-row"><Link to={`/spaces/${space.id}`}><h3>{space.name}</h3></Link><strong>{money(space.price)}<small>/hr</small></strong></div>
      <p className="space-location"><MapPin size={13}/>{[space.area,space.city].filter(Boolean).join(', ')}</p>
      <div className="card-rating"><Star size={14} fill={space.rating==null?'none':'currentColor'}/>{space.rating==null?<span>No public reviews</span>:<><strong>{space.rating.toFixed(1)}</strong><span>({space.reviews})</span></>}</div>
      <div className="tag-list">{space.amenities.slice(0,4).map((tag)=><span className="tag" key={tag}>{tag}</span>)}</div>
      <div className="space-card-actions"><Link className="button button-primary button-block" to={`/spaces/${space.id}`}>{space.isSample?'Preview only':'View & request'}</Link><button type="button" aria-label={saved?'Remove from saved locations':'Save location'} className={`save-button${saved?' is-saved':''}`} disabled={saving||space.isSample} onClick={toggleSaved}><Heart size={17} fill={saved?'currentColor':'none'}/></button></div>
    </div>
  </article>;
}
function FaqList({settings}) {
  const [active,setActive]=useState(-1);
  const items=faqs.map((faq)=>faq.question==='Can I pay online now?'&&settings?.paymentEnabled?{...faq,answer:'Payment settings are enabled for this project. The host still must accept a request, and the server confirms payment only from a valid provider webhook.'}:faq);
  return <div className="faq-list">{items.map((faq,index)=><div className={`faq-item${active===index?' is-open':''}`} key={faq.question}><button type="button" aria-expanded={active===index} onClick={()=>setActive(active===index?-1:index)}><span>{faq.question}</span><ChevronDown size={18}/></button>{active===index&&<p>{faq.answer}</p>}</div>)}</div>;
}

function ExplorePage() {
  const [params,setParams]=useSearchParams();
  const filters=useMemo(()=>({location:params.get('location')||'',category:params.get('category')||'',maxPriceKobo:params.get('maxPriceKobo')||'',amenities:(params.get('amenities')||'').split(',').filter(Boolean)}),[params]);
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [verifiedOnly,setVerifiedOnly]=useState(false);
  const state=usePublicListings(filters);
  const planningDate=params.get('date')||'';
  const planningCrew=params.has('crew')?Math.max(1,Math.min(500,Number(params.get('crew'))||1)):0;
  useEffect(()=>{
    if(!planningDate&&!planningCrew)return;
    try{sessionStorage.setItem('shootspace.discovery-preferences',JSON.stringify({date:planningDate,crew:planningCrew||2}));}catch{/* Search preferences are optional. */}
  },[planningDate,planningCrew]);
  const change=(key,value)=>{const next=new URLSearchParams(params);value?next.set(key,value):next.delete(key);setParams(next,{replace:true});};
  const toggleAmenity=(value)=>{const current=filters.amenities.includes(value)?filters.amenities.filter((item)=>item!==value):[...filters.amenities,value];change('amenities',current.join(','));};
  const reset=()=>{setParams(new URLSearchParams(),{replace:true});setVerifiedOnly(false);};
  const visible=verifiedOnly?state.listings.filter((item)=>item.verified):state.listings;
  return <div className="page-wrap wrap explore-page"><div className="explore-layout">
    <aside className={`filters-panel${filtersOpen?' is-open':''}`}><div className="filters-heading"><h2><SlidersHorizontal size={18}/> Filters</h2><button type="button" className="clear-filters" onClick={reset}>Clear</button></div>
      <label className="filter-control"><span>Location</span><input value={filters.location} onChange={(event)=>change('location',event.target.value)} placeholder="City or area"/></label>
      <label className="filter-control"><span>Production type</span><select value={filters.category} onChange={(event)=>change('category',event.target.value)}><option value="">All spaces</option>{categories.map((item)=><option key={item} value={item}>{item}</option>)}</select></label>
      <label className="filter-control"><span>Maximum hourly price (NGN)</span><input type="number" min="0" step="500" value={filters.maxPriceKobo?Number(filters.maxPriceKobo)/100:''} onChange={(event)=>change('maxPriceKobo',event.target.value?String(Math.round(Number(event.target.value)*100)):'')} placeholder="Any price"/></label>
      <div className="filter-group"><h3>Amenities</h3>{amenityLabels.map((item)=><label className="check-line" key={item}><input type="checkbox" checked={filters.amenities.includes(item)} onChange={()=>toggleAmenity(item)}/><span>{item}</span></label>)}</div>
      <label className="check-line filter-verified"><input type="checkbox" checked={verifiedOnly} onChange={(event)=>setVerifiedOnly(event.target.checked)}/><span>Admin-reviewed only</span><BadgeCheck size={16}/></label>
      <button className="button button-primary button-block mobile-apply" type="button" onClick={()=>setFiltersOpen(false)}>Show {visible.length} spaces</button>
    </aside>
    <section className="explore-results"><div className="explore-title-row"><div><p className="eyebrow">For your next shoot</p><h1>Explore locations</h1><p>{state.loading?'Checking published inventory…':state.error?'Live listings could not be loaded.':`${visible.length} published location${visible.length===1?'':'s'} matching these filters.`}</p>{(planningDate||planningCrew>0)&&<small className="planning-note">Planning preference{planningDate?` · ${dateOnly(planningDate)}`:''}{planningCrew?` · ${planningCrew} crew`:''}. Open each location to check its availability; results are not filtered by date.</small>}</div><button className="button button-secondary filter-toggle" type="button" onClick={()=>setFiltersOpen((value)=>!value)}><Filter size={16}/> Filters</button></div>
      {state.sample&&<SampleNotice/>}
      {state.error?<div className="empty-state"><CircleHelp size={24}/><h3>Live discovery is unavailable</h3><p>{state.error}</p><button className="button button-secondary" type="button" onClick={()=>window.location.reload()}>Retry</button></div>:state.loading?<div className="empty-state"><span className="loading-dot"/><p>Loading locations…</p></div>:visible.length?<div className="spaces-grid explore-grid">{visible.map((space)=><SpaceCard key={space.uuid||space.id} space={space}/>)}</div>:<div className="empty-state"><CircleHelp size={24}/><h3>No published spaces match these filters</h3><p>Try another city, category or amenity.</p><button className="button button-secondary" type="button" onClick={reset}>Reset filters</button></div>}
    </section>
  </div></div>;
}

function SpaceDetailsPage() {
  const {spaceId}=useParams();
  const state=usePublicListings(NO_FILTERS,spaceId);
  const searchPreferences=readSession('shootspace.discovery-preferences',{});
  const preferredDate=/^\d{4}-\d{2}-\d{2}$/.test(searchPreferences.date||'')?searchPreferences.date:futureDate();
  const [date,setDate]=useState(preferredDate);
  const [time,setTime]=useState('10:00');
  const [hours,setHours]=useState(4);
  const [crew,setCrew]=useState(Math.max(1,Math.min(500,Number(searchPreferences.crew)||2)));
  const [availability,setAvailability]=useState({loading:false,data:null,error:''});
  const [settings,setSettings]=useState(null);
  const [reviews,setReviews]=useState([]);
  const [reviewError,setReviewError]=useState('');
  const navigate=useNavigate();
  const toast=useToast();
  const space=state.listings[0]||null;
  useEffect(()=>{apiFetch('/api/settings').then(setSettings).catch(()=>setSettings(null));},[]);
  useEffect(()=>{
    if(!space?.uuid||space.isSample)return;
    let active=true;
    setAvailability({loading:true,data:null,error:''});
    apiFetch(`/api/availability?listingId=${encodeURIComponent(space.uuid)}&date=${encodeURIComponent(date)}`).then((data)=>{if(active)setAvailability({loading:false,data,error:''});}).catch((error)=>{if(active)setAvailability({loading:false,data:null,error:error.message});});
    return()=>{active=false;};
  },[space?.uuid,space?.isSample,date]);
  useEffect(()=>{
    if(!space?.uuid||space.isSample)return;
    let active=true;
    apiFetch(`/api/reviews?listingId=${encodeURIComponent(space.uuid)}`).then((result)=>{if(active)setReviews(result.reviews||[]);}).catch((error)=>{if(active)setReviewError(error.message);});
    return()=>{active=false;};
  },[space?.uuid,space?.isSample]);
  useEffect(()=>{if(space?.uuid)setHours(Math.max(1,space.minHours||1));},[space?.uuid,space?.minHours]);
  useEffect(()=>{if(space?.uuid&&space.capacity)setCrew((current)=>Math.min(space.capacity,current));},[space?.uuid,space?.capacity]);
  const slotStatus=availability.data?assessTimeSlot({date,startTime:time,durationHours:hours,openingHours:availability.data.openingHours,busySlots:availability.data.busySlots,blockedIntervals:availability.data.blockedIntervals}):{available:false,reason:availability.error?'Availability cannot be verified.':'Checking published availability…'};
  if(state.loading)return <div className="page-wrap wrap"><LoadingPanel text="Loading published location…"/></div>;
  if(state.error||!space)return <div className="not-found wrap"><div className="confirmed-icon"><Search size={27}/></div><p className="eyebrow">Location unavailable</p><h1>This location is not in public inventory.</h1><p>Only published, host-approved locations can be viewed and requested.</p><Link className="button button-primary" to="/explore">Explore locations <ArrowRight size={15}/></Link></div>;
  const subtotal=bookingBaseKobo(space.price,hours,crew);
  const fees=settings?.creatorFeeApproved?(subtotal*BigInt(settings.creatorFeeBps||0)+5000n)/10000n:0n;
  const requestBooking=()=>{
    if(space.isSample){toast('Development samples are not bookable.');return;}
    if(!settings?.bookingEnabled){toast('Booking requests are not enabled for this project yet.');return;}
    if(!slotStatus.available){toast(slotStatus.reason);return;}
    localStorage.setItem(BOOKING_KEY,JSON.stringify({listingId:space.uuid,listingSlug:space.id,title:space.name,date,time,hours:Number(hours),crew:Number(crew),productionType:space.category,idempotencyKey:null}));
    navigate('/checkout');
  };
  const galleryImages=space.images?.length?space.images.slice(0,3):[space.image];
  while(galleryImages.length<3)galleryImages.push('/images/space-placeholder.svg');
  const dayRules=availability.data?.openingHours||[];
  return <div className="page-wrap wrap detail-page">
    {space.isSample&&<SampleNotice/>}
    <div className="photo-gallery">{galleryImages.map((image,index)=><div className={`gallery-photo gallery-photo-${index+1}`} key={`${image}-${index}`}><img src={image} alt={`${space.name} location view ${index+1}`}/>{index===0&&space.verified&&<span className="verified-label"><CheckCircle2 size={13}/> Admin reviewed</span>}</div>)}<span className="gallery-count"><FileImage size={14}/>{space.images.length||0} approved photo{space.images.length===1?'':'s'}</span></div>
    <div className="detail-layout"><div className="detail-main"><div className="detail-title"><div><p className="eyebrow">{space.category}</p><h1>{space.name}{space.area?` – ${space.area}`:''}</h1><p>{space.description}</p><div className="detail-meta"><span><MapPin size={15}/>{[space.area,space.city].filter(Boolean).join(', ')}</span><span><Star size={15} fill={space.rating==null?'none':'currentColor'}/>{space.rating==null?'No public reviews':`${space.rating.toFixed(1)} (${space.reviews} reviews)`}</span></div></div></div>
      <section className="detail-section"><h2>Amenities</h2>{space.amenities.length?<div className="detail-amenities">{space.amenities.map((item)=><div className="detail-amenity" key={item}><Check size={16}/>{item}</div>)}</div>:<p className="helper-text">No amenities have been listed.</p>}</section>
      <section className="detail-section"><h2>House rules</h2>{space.rules.length?<ul className="rules-list">{space.rules.map((rule,index)=><li key={`${index}-${rule}`}>{rule}</li>)}</ul>:<p className="helper-text">No house rules were supplied in the listing.</p>}</section>
      <section className="detail-section"><h2>Reviews</h2>{reviewError?<p className="helper-text">Public reviews could not be loaded.</p>:reviews.length?reviews.map((review,index)=><div className="review-card" key={`${review.created_at}-${index}`}><div className="rating-stars" aria-label={`${review.rating} out of 5 stars`}>{Array.from({length:5},(_,star)=><Star key={star} fill={star<review.rating?'currentColor':'none'}/>)}</div><p>{review.body||'Rating only.'}</p><small>Completed booking review · {dateOnly(review.created_at)}</small></div>):<div className="review-card"><p>No public reviews have been published for this location.</p></div>}</section>
      <section className="detail-section"><h2>Location area</h2><div className="location-card"><div className="map-illustration"><div className="map-lines"/><span className="map-pin"><MapPin size={17} fill="currentColor"/></span><span className="map-label">{(space.area||space.city||'Location').toUpperCase()}</span></div><p>{space.city}{space.area?` · ${space.area}`:''}. The exact arrival address is shared only with booking participants after server-confirmed payment.</p></div></section>
    </div>
    <aside className="booking-card"><div className="booking-rate"><strong>{money(space.price)}</strong><span>/hour per person</span></div>
      <label className="form-field"><span>Shoot date</span><input type="date" min={futureDate(0)} value={date} onChange={(event)=>setDate(event.target.value)}/></label>
      <label className="form-field"><span>Start time (Lagos time)</span><input type="time" step="3600" value={time} onChange={(event)=>setTime(event.target.value)}/></label>
      <label className="form-field"><span>Booking duration</span><select value={hours} onChange={(event)=>setHours(Number(event.target.value))}>{Array.from({length:Math.max(1,Math.min(24-space.minHours+1,24))},(_,index)=>space.minHours+index).map((hour)=><option value={hour} key={hour}>{hour} hour{hour===1?'':'s'}</option>)}</select></label>
      <label className="form-field"><span>Crew size · maximum {space.capacity} · price multiplies by crew</span><input type="number" min="1" max={space.capacity||1} value={crew} onChange={(event)=>setCrew(Math.max(1,Math.min(space.capacity||1,Number(event.target.value)||1)))}/></label>
      <div className="booking-costs"><div><span>{money(space.price)} per person × {hours} hours × {crew} {crew===1?'person':'people'}</span><strong>{money(subtotal)}</strong></div>{fees>0n&&<div><span>Owner-approved creator fee</span><strong>{money(fees)}</strong></div>}<div className="cost-total"><span>Estimated request total</span><strong>{money(subtotal+fees)}</strong></div><small>Base = hourly rate per person × hours × crew size. Final server calculation is returned with the request. Commission is 15% of booking base (host share 85%).</small></div>
      {availability.loading?<p className="booking-secure"><Clock3 size={14}/> Checking published availability…</p>:availability.error?<p className="availability-warning">Availability could not be loaded; requests are paused until it can be checked.</p>:<div className="availability-summary"><strong>{dateOnly(date)}</strong>{dayRules.length?dayRules.map((rule)=><span key={`${rule.opens_at}-${rule.closes_at}`}>{String(rule.opens_at).slice(0,5)}–{String(rule.closes_at).slice(0,5)} Africa/Lagos</span>):<span>No weekly opening hours published for this day.</span>}</div>}
      {availability.data&&<p className={slotStatus.available?'availability-open':'availability-warning'} role="status">{slotStatus.reason}</p>}
      <button type="button" className="button button-primary button-block" disabled={space.isSample||!settings?.bookingEnabled||availability.loading||!availability.data||!slotStatus.available} onClick={requestBooking}>{space.isSample?'Preview only':'Request to book'} <ArrowRight size={16}/></button>
      {!settings?.bookingEnabled&&!space.isSample&&<p className="helper-text">Booking requests are paused until the owner has configured the database and reviewed cancellation policy.</p>}
      {settings?.commissionBps&&<p className="booking-secure"><ShieldCheck size={14}/> Host approval required · no payment taken at request stage.</p>}
    </aside></div>
  </div>;
}

function AuthPage({isRegister=false}) {
  const navigate=useNavigate();
  const toast=useToast();
  const [form,setForm]=useState({displayName:'',email:'',password:'',accepted:false});
  const [working,setWorking]=useState(false);
  const [error,setError]=useState('');
  const [sent,setSent]=useState(false);
  const [params]=useSearchParams();
  const next=params.get('next');
  const safeNext=next&&next.startsWith('/')&&!next.startsWith('//')?next:'/creator-dashboard';
  const submit=async(event)=>{
    event.preventDefault();setError('');
    if(!supabase){setError('Account service is not configured. No local or demo account will be created.');return;}
    if(isRegister&&!form.accepted){setError('Please acknowledge the draft policies before continuing.');return;}
    setWorking(true);
    try{
      const result=isRegister
        ?await supabase.auth.signUp({email:form.email.trim(),password:form.password,options:{data:{display_name:form.displayName.trim()}}})
        :await supabase.auth.signInWithPassword({email:form.email.trim(),password:form.password});
      if(result.error)throw result.error;
      if(isRegister&&!result.data.session){setSent(true);return;}
      toast(isRegister?'Account created.':'Signed in.');
      navigate(safeNext,{replace:true});
    }catch(err){setError(err.message||'Authentication could not be completed.');}
    finally{setWorking(false);}
  };
  return <div className="auth-screen"><section className="auth-card"><p className="eyebrow">ShootSpace Africa</p><h1>{isRegister?'Create account':'Welcome back'}</h1><p>{isRegister?'Create an account to request bookings or submit a host application.':'Sign in to continue to your bookings and account.'}</p>
    {sent?<div className="inline-success"><CheckCircle2 size={21}/><div><strong>Check your email</strong><p>Confirm your address before signing in. No session has been created yet.</p></div></div>:<form onSubmit={submit} className="auth-form">
      {isRegister&&<label className="form-field"><span>Name</span><input required maxLength={120} value={form.displayName} onChange={(event)=>setForm({...form,displayName:event.target.value})} placeholder="Name" autoComplete="name"/></label>}
      <label className="form-field"><span>Email address</span><input required type="email" value={form.email} onChange={(event)=>setForm({...form,email:event.target.value})} placeholder="Email address" autoComplete="email"/></label>
      <label className="form-field"><span>Password</span><input required minLength={8} type="password" value={form.password} onChange={(event)=>setForm({...form,password:event.target.value})} placeholder="At least 8 characters" autoComplete={isRegister?'new-password':'current-password'}/></label>
      {isRegister&&<label className="remember-check"><input type="checkbox" checked={form.accepted} onChange={(event)=>setForm({...form,accepted:event.target.checked})}/> I have read the draft <Link to="/terms">terms</Link> and <Link to="/privacy">privacy notice</Link>.</label>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="button button-primary button-block" disabled={working}>{working?'Please wait…':isRegister?'Create account':'Sign in'} <ArrowRight size={15}/></button>
    </form>}
    <p className="auth-switch">{isRegister?'Already have an account?':'New to ShootSpace?'} <Link to={isRegister?'/signin':'/signup'}>{isRegister?'Sign in':'Create account'}</Link></p>
  </section></div>;
}

function CheckoutPage() {
  const draft=readLocal(BOOKING_KEY,null);
  const state=usePublicListings(NO_FILTERS,draft?.listingSlug||'');
  const navigate=useNavigate();
  const toast=useToast();
  const [settings,setSettings]=useState(null);
  const [details,setDetails]=useState({productionType:'',notes:''});
  const [working,setWorking]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{apiFetch('/api/settings').then(setSettings).catch(()=>setSettings(null));},[]);
  if(!draft||!draft.listingId)return <div className="page-wrap wrap"><EmptyPanel title="No booking request is ready" text="Choose a published location and date before continuing." action={<Link className="button button-primary" to="/explore">Explore locations</Link>}/></div>;
  if(state.loading)return <div className="page-wrap wrap"><LoadingPanel text="Loading booking details…"/></div>;
  const space=state.listings[0];
  if(!space||space.isSample)return <div className="page-wrap wrap"><EmptyPanel title="This location cannot be requested" text="Only real published inventory can proceed to a host request." action={<Link className="button button-primary" to="/explore">Browse published inventory</Link>}/></div>;
  const subtotal=bookingBaseKobo(space.price,Number(draft.hours||1),Number(draft.crew||1));
  const fee=settings?.creatorFeeApproved?(subtotal*BigInt(settings.creatorFeeBps||0)+5000n)/10000n:0n;
  const sendRequest=async(event)=>{
    event.preventDefault();setError('');
    if(!settings?.bookingEnabled){setError('Booking is paused until the owner configures and approves the required policies.');return;}
    setWorking(true);
    try{
      const key=draft.idempotencyKey||makeIdempotencyKey();
      const next={...draft,idempotencyKey:key};
      localStorage.setItem(BOOKING_KEY,JSON.stringify(next));
      const startsAt=localDateAtLagos(draft.date,draft.time);
      const endsAt=new Date(new Date(startsAt).valueOf()+Number(draft.hours)*3600000).toISOString();
      const result=await apiFetch('/api/bookings/request',{method:'POST',body:{listingId:draft.listingId,startsAt,endsAt,crewSize:Number(draft.crew),productionType:details.productionType||space.category,notes:details.notes,idempotencyKey:key}});
      localStorage.setItem(BOOKING_KEY,JSON.stringify({...next,bookingId:result.booking_id,publicCode:result.public_code,bookingStatus:result.booking_status}));
      toast('Booking request sent. The host must respond before payment.');
      navigate(`/booking-confirmed?bookingId=${encodeURIComponent(result.booking_id)}`,{state:{requestCreated:true}});
    }catch(err){setError(err.message||'The request could not be sent.');}
    finally{setWorking(false);}
  };
  return <div className="page-wrap wrap checkout-page"><div className="checkout-main"><p className="eyebrow">Request to book</p><h1>Review your shoot request</h1>
    <div className="panel checkout-summary"><h2>{space.name}</h2><p>{[space.area,space.city].filter(Boolean).join(', ')}</p><div className="summary-meta"><span><CalendarDays size={14}/>{dateOnly(draft.date)} · {draft.time} Lagos time</span><span><Clock3 size={14}/>{draft.hours} hours · {draft.crew} crew</span></div></div>
    <form className="panel request-details" onSubmit={sendRequest}><h2>Production details</h2><label className="form-field"><span>Production type</span><input required maxLength={100} value={details.productionType||space.category} onChange={(event)=>setDetails({...details,productionType:event.target.value})}/></label><label className="form-field"><span>Notes for the host (optional)</span><textarea maxLength={2000} rows="4" value={details.notes} onChange={(event)=>setDetails({...details,notes:event.target.value})} placeholder="Add a practical note about your shoot or setup."/></label>
      <div className="request-explainer"><MessageSquare size={18}/><div><strong>This is a request, not a confirmed booking.</strong><p>The host has to accept first. No payment will be initiated here. If payments are enabled, you will pay after the host accepts and the server will verify provider status.</p></div></div>
      {!settings?.cancellationPolicyApproved&&<p className="draft-policy-notice">Cancellation policy is not approved in platform settings. Requests stay disabled until the owner configures an approved policy.</p>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="button button-primary" disabled={working||!settings?.bookingEnabled}>{working?'Sending request…':'Send booking request'} <ArrowRight size={15}/></button>
    </form>
  </div><aside className="panel checkout-total-card"><h2>Estimated amount</h2><div className="cost-row"><span>{money(space.price)} per person × {draft.hours} hours × {draft.crew} {Number(draft.crew)===1?'person':'people'}</span><strong>{money(subtotal)}</strong></div>{fee>0n&&<div className="cost-row"><span>Owner-approved creator fee</span><strong>{money(fee)}</strong></div>}<div className="cost-total"><span>Estimated total</span><strong>{money(subtotal+fee)}</strong></div><div className="checkout-assurances"><div><Shield size={15}/>No payment at request stage</div><div><CheckCircle2 size={15}/>Request reviewed by the host</div><div><Clock3 size={15}/>Availability rechecked by server</div></div><p className="helper-text">The rate is per person per hour, so the base is rate × hours × crew. 15% commission is calculated on the booking base. The host share is 85%. This estimate is not a payment receipt.</p></aside></div>;
}

function BookingConfirmedPage() {
  const [params]=useSearchParams();
  const navigate=useNavigate();
  const toast=useToast();
  const bookingId=params.get('bookingId');
  const reference=params.get('reference');
  const [booking,setBooking]=useState(null);
  const [payment,setPayment]=useState(null);
  const [loading,setLoading]=useState(Boolean(bookingId||reference));
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;let timer;let attempts=0;
    const load=async()=>{
      try{
        if(reference){
          const status=await apiFetch(`/api/payments/status?reference=${encodeURIComponent(reference)}`);
          if(!active)return;
          setPayment(status);
          if(status.status==='paid'){
            const detail=await apiFetch(`/api/bookings/${encodeURIComponent(status.bookingId)}`);
            if(active){setBooking(detail.booking);setLoading(false);}
            return;
          }
          if(['failed','refund_pending','refunded','partially_refunded'].includes(status.status)||attempts>=7){setLoading(false);return;}
        }
        if(bookingId){
          const result=await apiFetch(`/api/bookings/${encodeURIComponent(bookingId)}`);
          if(active){setBooking(result.booking);setLoading(false);}
          return;
        }
      }catch(err){if(active){setError(err.message);setLoading(false);}}
      if(active&&reference&&attempts<7){attempts+=1;timer=window.setTimeout(load,2500);}
      else if(active)setLoading(false);
    };
    if(bookingId||reference)load();
    return()=>{active=false;if(timer)window.clearTimeout(timer);};
  },[bookingId,reference]);
  const issueCode=async()=>{
    try{const result=await apiFetch('/api/bookings/otp',{method:'POST',body:{action:'issue',bookingId:booking?.id}});setBooking((current)=>({...current,issuedCode:result.code,otpExpiresAt:result.expires_at}));}
    catch(err){toast(err.message);}
  };
  const copyCode=async()=>{try{await navigator.clipboard.writeText(booking.issuedCode);toast('Code copied. It is shown only once in this page.');}catch{toast('Clipboard permission was not available.');}};
  if(loading)return <div className="confirmed-page wrap"><div className="confirmed-icon"><Clock3 size={30}/></div><p className="eyebrow">Checking status</p><h1>Waiting for server confirmation</h1><p className="confirmed-lede">A browser return is not proof of payment. The server is checking the provider event.</p></div>;
  if(error)return <div className="confirmed-page wrap"><div className="confirmed-icon"><CircleHelp size={30}/></div><p className="eyebrow">Status unavailable</p><h1>We could not confirm this booking.</h1><p className="confirmed-lede">{error}</p><Link className="button button-primary" to="/creator-dashboard">Open creator dashboard</Link></div>;
  if(payment&&payment.status!=='paid')return <div className="confirmed-page wrap"><div className="confirmed-icon"><Clock3 size={30}/></div><p className="eyebrow">Payment state · {displayStatus(payment.status)}</p><h1>{payment.status==='pending'?'Payment is still pending':'Payment was not confirmed'}</h1><p className="confirmed-lede">The provider callback did not confirm a payment. Do not treat this page as a receipt. Check the creator dashboard for the current server status.</p><Link className="button button-primary" to="/creator-dashboard">View creator dashboard</Link></div>;
  if(payment?.status==='paid'&&booking&&!['confirmed','checked_in','completion_pending','completed','disputed'].includes(booking.booking_status))return <div className="confirmed-page wrap"><div className="confirmed-icon"><CircleHelp size={30}/></div><p className="eyebrow">Payment captured · review required</p><h1>Booking is not confirmed</h1><p className="confirmed-lede">The provider reports a payment, but the booking was not eligible for automatic confirmation. The payment is recorded for manual review; no payout is released.</p><Link className="button button-primary" to="/contact">Contact the owner</Link></div>;
  if(booking&&!['confirmed','checked_in','completion_pending','completed','disputed'].includes(booking.booking_status))return <div className="confirmed-page wrap"><div className="confirmed-icon"><MessageSquare size={30}/></div><p className="eyebrow">Booking status · {displayStatus(booking.booking_status)}</p><h1>{booking.booking_status==='request_pending'?'Booking request received':`Booking ${displayStatus(booking.booking_status)}`}</h1><p className="confirmed-lede">{booking.listing_title_snapshot||'Your selected location'} · {dateTime(booking.starts_at)}. A host decision and verified payment are required before the booking is confirmed.</p><div className="panel request-reference"><strong>{booking.public_code}</strong><p>Request total: {money(booking.total_amount_kobo)} · Payment state: {displayStatus(booking.payment_status)}</p></div><div className="confirmed-actions"><Link className="button button-primary" to="/creator-dashboard">View booking status</Link><Link className="button button-secondary" to="/explore">Explore more locations</Link></div></div>;
  if(!booking)return <div className="confirmed-page wrap"><div className="confirmed-icon"><CircleHelp size={30}/></div><p className="eyebrow">No booking details</p><h1>Open a booking from your dashboard.</h1><Link className="button button-primary" to="/creator-dashboard">Creator dashboard</Link></div>;
  return <div className="confirmed-page wrap"><div className="confirmed-icon"><CheckCircle2 size={34}/></div><p className="eyebrow">Provider-verified payment</p><h1>Booking Confirmed</h1><p className="confirmed-lede">{booking.listing?.title||booking.listing_title_snapshot} · {dateTime(booking.starts_at)}. Payment is confirmed by the server. Payout remains held until completion, configured delay and dispute checks.</p>
    {booking.issuedCode?<button type="button" className="otp-display" onClick={copyCode}><span>CHECK-IN CODE · SHOWN ONCE</span><strong>{booking.issuedCode}</strong><small>Expires {dateTime(booking.otpExpiresAt)} · <Copy size={13}/> Copy</small></button>:<div className="panel"><h2>Check-in code</h2><p className="helper-text">The creator can issue one only inside the configured check-in window. A code is never stored in the browser for later retrieval.</p><button className="button button-primary" type="button" onClick={issueCode}>Generate check-in code <KeyRound size={15}/></button></div>}
    <div className="confirmed-info-grid"><div className="panel"><h2>Booking</h2><p>{booking.public_code} · {displayStatus(booking.booking_status)}</p><p>{booking.listing?.exact_address||'Exact arrival details are available to booking participants.'}</p></div><div className="panel"><h2>Payment &amp; payout</h2><p>Payment: {displayStatus(booking.payment_status)}</p><p>Payout: {displayStatus(booking.payout_status)}. Check-in alone does not release it.</p><p>Host: {booking.host?.public_display_name||'Host'}</p></div></div>
    <div className="confirmed-actions"><Link className="button button-primary" to={`/otp-room?bookingId=${encodeURIComponent(booking.id)}`}>Open check-in room</Link><Link className="button button-secondary" to="/creator-dashboard">Creator dashboard</Link></div>
  </div>;
}

function useDashboard(role) {
  const [state,setState]=useState({data:null,loading:true,error:''});
  const [version,setVersion]=useState(0);
  const refresh=()=>setVersion((value)=>value+1);
  useEffect(()=>{let active=true;setState({data:null,loading:true,error:''});apiFetch(`/api/dashboard?role=${role}`).then((data)=>{if(active)setState({data,loading:false,error:''});}).catch((error)=>{if(active)setState({data:null,loading:false,error:error.message});});return()=>{active=false;};},[role,version]);
  return {...state,refresh};
}
function DashboardHeader({title,subtitle,eyebrow}) { return <div className="dashboard-heading"><div>{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1><p>{subtitle}</p></div></div>; }
function StatCard({icon:Icon,label,value}) { return <div className="stat-card"><div className="stat-icon"><Icon size={19}/></div><span>{label}</span><strong>{value}</strong></div>; }
function ActionRow({children,to,onClick}) { const content=<>{children}<ChevronRight size={17}/></>;return to?<Link className="action-row" to={to}>{content}</Link>:<button type="button" className="action-row" onClick={onClick}>{content}</button>; }
function DashboardError({error}) { return <div className="dashboard-error"><CircleHelp size={20}/><div><strong>Dashboard data unavailable</strong><p>{error}</p><Link to="/signin">Sign in with an authorized account</Link></div></div>; }
function StatusBadge({value}) { return <span className={`badge ${statusClass(value)}`}>{displayStatus(value)}</span>; }
function BookingRow({booking,children}) {
  return <article className="booking-row"><div className="booking-row-main"><strong>{booking.listing_title_snapshot||'Production location'}</strong><span>{booking.public_code} · {dateTime(booking.starts_at)}</span><span>{booking.crew_size?`${booking.crew_size} crew · `:''}{displayStatus(booking.booking_status)} · payment {displayStatus(booking.payment_status)}</span></div><div className="booking-row-side"><StatusBadge value={booking.payout_status}/>{children}</div></article>;
}

function CreatorDashboard() {
  const {data,loading,error,refresh}=useDashboard('creator');
  const [settings,setSettings]=useState(null);
  const [actionError,setActionError]=useState('');
  const [busyId,setBusyId]=useState('');
  useEffect(()=>{apiFetch('/api/settings').then(setSettings).catch(()=>setSettings(null));},[]);
  const pay=async(booking)=>{
    setActionError('');setBusyId(booking.id);
    try{
      const storageKey=`shootspace.payment-key.${booking.id}`;
      if(booking.payment_status==='failed')localStorage.removeItem(storageKey);
      let idempotencyKey=localStorage.getItem(storageKey);
      if(!idempotencyKey){idempotencyKey=makeIdempotencyKey();localStorage.setItem(storageKey,idempotencyKey);}
      const result=await apiFetch('/api/payments/initialize',{method:'POST',body:{bookingId:booking.id,idempotencyKey}});
      if(!result.authorization_url)throw new Error('The payment provider did not return a checkout URL.');
      window.location.assign(result.authorization_url);
    }catch(err){setActionError(err.message);refresh();}
    finally{setBusyId('');}
  };
  const cancel=async(booking)=>{
    if(!window.confirm('Cancel this unpaid booking request?'))return;
    setActionError('');setBusyId(booking.id);
    try{await apiFetch('/api/bookings/cancel',{method:'POST',body:{bookingId:booking.id,reason:'Creator cancelled before confirmed payment.'}});refresh();}
    catch(err){setActionError(err.message);}
    finally{setBusyId('');}
  };
  if(loading)return <div className="dashboard-page wrap"><LoadingPanel text="Loading creator records…"/></div>;
  if(error)return <div className="dashboard-page wrap"><DashboardHeader title="Creator dashboard" subtitle="Your persisted bookings and saved locations."/><DashboardError error={error}/></div>;
  const bookings=data.bookings||[];
  const upcoming=bookings.filter((booking)=>booking.starts_at>=new Date().toISOString()&&!['cancelled','declined','expired'].includes(booking.booking_status));
  const past=bookings.filter((booking)=>booking.ends_at<new Date().toISOString());
  const saved=(data.favoriteListingIds||[]).map((id)=><ActionRow key={id} to={`/spaces/${id}`}>Open saved published location</ActionRow>);
  return <div className="dashboard-page wrap"><DashboardHeader title="Creator dashboard" subtitle="Persisted booking, payment and notification records."/>
    <div className="stats-grid"><StatCard icon={CalendarDays} label="Upcoming bookings" value={data.metrics.upcomingBookings}/><StatCard icon={Camera} label="Past bookings" value={data.metrics.pastBookings}/><StatCard icon={Heart} label="Saved spaces" value={data.metrics.savedSpaces}/><StatCard icon={Bell} label="Unread notifications" value={data.metrics.unreadNotifications}/></div>
    {actionError&&<p className="form-error" role="alert">{actionError}</p>}
    <div className="dashboard-grid two-columns"><section className="panel"><h2>Upcoming &amp; active bookings</h2>{upcoming.length?upcoming.map((booking)=><BookingRow key={booking.id} booking={booking}><div className="booking-actions">
      {['accepted_awaiting_payment','payment_pending'].includes(booking.booking_status)&&<button type="button" className="button button-primary button-small" onClick={()=>pay(booking)} disabled={busyId===booking.id||!settings?.paymentEnabled}>{busyId===booking.id?'Opening…':booking.payment_status==='pending'?'Resume payment':'Pay with provider'}</button>}
      {booking.booking_status==='completion_pending'&&<button type="button" className="button button-secondary button-small" onClick={async()=>{setBusyId(booking.id);try{await apiFetch('/api/bookings/completion',{method:'POST',body:{action:'creator_confirm',bookingId:booking.id}});refresh();}catch(err){setActionError(err.message);}finally{setBusyId('');}}}>Confirm completion</button>}
      {booking.payment_status!=='paid'&&['request_pending','accepted_awaiting_payment','payment_pending'].includes(booking.booking_status)&&<button type="button" className="button button-secondary button-small" onClick={()=>cancel(booking)} disabled={busyId===booking.id}>Cancel unpaid request</button>}
      {booking.payment_status==='paid'&&<Link className="button button-secondary button-small" to={`/otp-room?bookingId=${encodeURIComponent(booking.id)}`}>Booking details</Link>}
      {booking.payment_status==='paid'&&<Link className="text-link" to={`/dispute?bookingId=${encodeURIComponent(booking.id)}`}>Open dispute</Link>}
    </div></BookingRow>):<p className="empty-inline">No upcoming booking records.</p>}</section>
    <section className="panel"><h2>Saved locations</h2>{saved.length?saved:<p className="empty-inline">No saved published locations yet.</p>}</section>
    <section className="panel"><h2>Recent booking history</h2>{past.length?past.slice(-8).map((booking)=><BookingRow key={booking.id} booking={booking}><Link className="text-link" to={`/dispute?bookingId=${encodeURIComponent(booking.id)}`}>Dispute centre</Link></BookingRow>):<p className="empty-inline">No past booking records.</p>}</section>
    <section className="panel dashboard-feature"><div className="panel-title-icon"><ShieldCheck size={18}/><h2>Payment and payout states</h2></div><p>Payment confirmation comes from the signed server webhook. Payout eligibility is separate; check-in does not release funds. Provider setup is required before a payment button is enabled.</p><Link className="button button-secondary" to="/cancellation">Read cancellation policy draft</Link></section></div>
  </div>;
}

function HostDashboard() {
  const {data,loading,error,refresh}=useDashboard('host');
  const [actionError,setActionError]=useState('');
  const [busyId,setBusyId]=useState('');
  const [changeFor,setChangeFor]=useState('');
  const respond=async(booking,accept)=>{
    setActionError('');setBusyId(booking.id);
    try{await apiFetch('/api/bookings/respond',{method:'POST',body:{bookingId:booking.id,accept,reason:accept?'Host accepted after review.':'Host declined this request.'}});refresh();}
    catch(err){setActionError(err.message);}
    finally{setBusyId('');}
  };
  if(loading)return <div className="dashboard-page wrap"><LoadingPanel text="Loading host records…"/></div>;
  if(error)return <div className="dashboard-page wrap"><DashboardHeader title="Host dashboard" subtitle="Persisted listings, requests and payout records."/><DashboardError error={error}/></div>;
  const bookings=data.bookings||[];
  const requests=bookings.filter((booking)=>booking.booking_status==='request_pending');
  const active=bookings.filter((booking)=>!['request_pending','declined','cancelled','expired'].includes(booking.booking_status));
  return <div className="dashboard-page wrap"><DashboardHeader title="Host dashboard" subtitle="Requests, listing status and held/eligible payout records."/>
    <div className="host-verification-banner"><BadgeCheck size={18}/><span>Host review: <strong>{displayStatus(data.host?.verification_status||'not_started')}</strong>{data.host?.review_reason?` · ${data.host.review_reason}`:''}</span></div>
    <div className="stats-grid"><StatCard icon={Banknote} label="Host share recorded" value={money(data.metrics.hostShareKobo)}/><StatCard icon={Wallet} label="Payout held" value={money(data.metrics.payoutHeldKobo)}/><StatCard icon={CheckCircle2} label="Payout eligible" value={money(data.metrics.payoutEligibleKobo)}/><StatCard icon={CalendarDays} label="Upcoming bookings" value={data.metrics.upcomingBookings}/></div>
    {actionError&&<p className="form-error" role="alert">{actionError}</p>}
    <div className="dashboard-grid two-columns"><section className="panel"><h2>Incoming requests</h2>{requests.length?requests.map((booking)=><BookingRow key={booking.id} booking={booking}><div className="booking-actions"><button className="button button-primary button-small" type="button" disabled={busyId===booking.id} onClick={()=>respond(booking,true)}>Accept</button><button className="button button-secondary button-small" type="button" disabled={busyId===booking.id} onClick={()=>respond(booking,false)}>Decline</button></div></BookingRow>):<p className="empty-inline">No pending host requests.</p>}</section>
    <section className="panel"><h2>Active booking operations</h2>{active.length?active.map((booking)=><BookingRow key={booking.id} booking={booking}><div className="booking-actions">{booking.payment_status==='paid'&&<Link className="button button-secondary button-small" to={`/otp-room?bookingId=${encodeURIComponent(booking.id)}`}>Check-in room</Link>}{booking.booking_status==='checked_in'&&<button className="button button-primary button-small" type="button" onClick={async()=>{setBusyId(booking.id);try{await apiFetch('/api/bookings/completion',{method:'POST',body:{action:'host_submit',bookingId:booking.id}});refresh();}catch(err){setActionError(err.message);}finally{setBusyId('');}}}>Submit completion</button>}{booking.payment_status==='paid'&&<Link className="text-link" to={`/dispute?bookingId=${encodeURIComponent(booking.id)}`}>Open dispute</Link>}</div></BookingRow>):<p className="empty-inline">No active booking records.</p>}</section>
    <section className="panel"><div className="panel-title-row"><h2>Your listings</h2><Link className="button button-primary button-small" to="/host/listings/new">+ Add another space</Link></div><p className="helper-text">New spaces go through admin review before they are published. Changing a live space needs a reason and admin approval first; the live listing stays as it is until then.</p>{data.listings?.length?data.listings.map((listing)=>{const requests=(data.listingChangeRequests||[]).filter((item)=>item.listing_id===listing.id);const pending=requests.find((item)=>item.status==='pending');const latest=requests[0];return <div key={listing.id}><div className="listing-row"><span><strong>{listing.title}</strong><small>{[listing.neighbourhood,listing.city].filter(Boolean).join(', ')}</small></span><span className="listing-row-actions"><StatusBadge value={listing.status}/>{pending&&<span className="badge badge-yellow">Change pending admin review</span>}{listing.status==='published'&&!pending&&<button type="button" className="button button-secondary button-small" onClick={()=>setChangeFor(changeFor===listing.id?'':listing.id)}>{changeFor===listing.id?'Close':'Request a change'}</button>}</span></div>{!pending&&latest?.status==='rejected'&&<p className="helper-text">Last change request was not approved{latest.review_reason?`: ${latest.review_reason}`:'.'}</p>}{!pending&&latest?.status==='approved'&&<p className="helper-text">Last change request was approved{latest.reviewed_at?` on ${dateTime(latest.reviewed_at)}`:''}.</p>}{changeFor===listing.id&&<ListingChangeForm listing={listing} onDone={()=>{setChangeFor('');refresh();}} onCancel={()=>setChangeFor('')}/>}</div>}):<><p className="empty-inline">No listing drafts or published locations.</p><Link className="button button-secondary" to="/host/onboarding">Submit a real location</Link></>}</section>
    <HostWithdrawalsPanel data={data} refresh={refresh}/>
    <section className="panel dashboard-feature"><h2>About payout timing</h2><p>Completed sessions remain held. A scheduled job can mark a payout eligible only after the configured delay and dispute checks. This product does not send a transfer or promise escrow.</p><p>Paid out so far: <strong>{money(data.metrics.paidOutKobo)}</strong></p></section></div>
  </div>;
}

// Converts integer kobo to a plain naira figure for editing (for example 1500000 -> "15000").
function koboToNairaInput(kobo) {
  const value = BigInt(kobo || 0);
  const whole = value / 100n;
  const cents = value % 100n;
  return cents ? `${whole}.${cents.toString().padStart(2, '0')}` : whole.toString();
}

const CHANGE_FIELD_LABELS = Object.freeze({
  hourly_rate_kobo: 'Rate per person per hour',
  min_hours: 'Minimum hours',
  crew_capacity: 'Crew capacity',
  description: 'Description',
  public_location: 'Public area',
  category: 'Category',
  house_rules: 'House rules',
});

function changeValueText(field, value) {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (field === 'hourly_rate_kobo') return `${money(value)} per person per hour`;
  if (Array.isArray(value)) return value.length ? value.join(' · ') : 'None';
  const text = String(value);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

// Shows each proposed field as "current → proposed". Used by the host's history and the admin queue.
function ChangeDiff({listing, proposed}) {
  return <div className="change-diff">{Object.entries(proposed||{}).map(([field,next])=><div className="change-diff-row" key={field}><strong>{CHANGE_FIELD_LABELS[field]||field}</strong><span>{listing?changeValueText(field,listing[field]):'Current value unavailable'}</span><span aria-hidden="true">→</span><span>{changeValueText(field,next)}</span></div>)}</div>;
}

// Host form: only fields that differ from the live listing are sent. Photos are not part of this form.
function ListingChangeForm({listing, onDone, onCancel}) {
  const [form,setForm]=useState({
    rateNaira: koboToNairaInput(listing.hourly_rate_kobo),
    minHours: String(listing.min_hours||1),
    crew: String(listing.crew_capacity||1),
    description: listing.description||'',
    publicLocation: listing.public_location||'',
    rules: (listing.house_rules||[]).join('\n'),
    reason: '',
  });
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const set=(key)=>(event)=>setForm((current)=>({...current,[key]:event.target.value}));
  const submit=async(event)=>{
    event.preventDefault();
    setError('');
    const changes={};
    let rateKobo;
    try { rateKobo=Number(parseNairaToKobo(form.rateNaira)); } catch(err) { setError(err.message); return; }
    if(rateKobo!==Number(listing.hourly_rate_kobo)) changes.hourly_rate_kobo=rateKobo;
    if(Number(form.minHours)!==Number(listing.min_hours)) changes.min_hours=Number(form.minHours);
    if(Number(form.crew)!==Number(listing.crew_capacity)) changes.crew_capacity=Number(form.crew);
    if(form.description.trim()!==(listing.description||'').trim()) changes.description=form.description.trim();
    if(form.publicLocation.trim()!==(listing.public_location||'').trim()) changes.public_location=form.publicLocation.trim();
    const rules=form.rules.split('\n').map((item)=>item.trim()).filter(Boolean);
    if(JSON.stringify(rules)!==JSON.stringify(listing.house_rules||[])) changes.house_rules=rules;
    if(!Object.keys(changes).length){ setError('Change at least one field before sending a request.'); return; }
    if(form.reason.trim().length<10){ setError('Explain why the change is needed (at least 10 characters).'); return; }
    setBusy(true);
    try {
      await apiFetch('/api/host/listings/change-request',{method:'POST',body:{listingId:listing.id,changes,reason:form.reason.trim()}});
      onDone();
    } catch(err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const enteredKobo=(()=>{ try { return BigInt(parseNairaToKobo(form.rateNaira)); } catch { return null; } })();
  const hours=Number(form.minHours), crew=Number(form.crew);
  const exampleKobo=enteredKobo!==null&&hours>0&&crew>0?enteredKobo*BigInt(crew)*BigInt(hours):null;
  return <form className="panel change-request-form" onSubmit={submit}>
    <h3>Request a change to this space</h3>
    <p className="helper-text">The live listing stays as it is until an admin approves your request. Photos cannot be changed here yet; contact the platform owner for photo changes.</p>
    <label className="field"><span>Rate per person per hour (NGN)</span><input inputMode="decimal" value={form.rateNaira} onChange={set('rateNaira')}/></label>
    <p className="helper-text">Every person in the crew pays this rate for each hour. {exampleKobo!==null?`Example with your numbers: ${money(enteredKobo)} × ${crew} people × ${hours} hour(s) = ${money(exampleKobo)} before commission.`:'Enter a valid rate, crew size and hours to see the total.'}</p>
    <div className="form-grid">
      <label className="field"><span>Minimum hours</span><input type="number" min="1" max="24" value={form.minHours} onChange={set('minHours')}/></label>
      <label className="field"><span>Crew capacity (people)</span><input type="number" min="1" max="100" value={form.crew} onChange={set('crew')}/></label>
    </div>
    <label className="field"><span>Public area</span><input value={form.publicLocation} onChange={set('publicLocation')}/></label>
    <label className="field"><span>Description</span><textarea rows="3" value={form.description} onChange={set('description')}/></label>
    <label className="field"><span>House rules (one per line)</span><textarea rows="3" value={form.rules} onChange={set('rules')}/></label>
    <label className="field"><span>Reason for the change (required)</span><textarea rows="3" required minLength={10} maxLength={2000} value={form.reason} onChange={set('reason')} placeholder="For example: our new equipment needs a larger crew allowance."/></label>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="booking-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy?'Sending…':'Send for approval'}</button><button className="button button-secondary" type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}

// Host payouts: record-and-track only. Nothing here moves money; the owner pays manually and marks it paid.
function HostWithdrawalsPanel({data, refresh}) {
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const metrics=data.metrics||{};
  const available=BigInt(metrics.payoutAvailableKobo||0);
  const request=async()=>{
    if(available<=0n) return;
    if(!window.confirm(`Record a withdrawal request for ${money(metrics.payoutAvailableKobo)}? This only records your request. The platform owner pays it to your bank manually and then marks it paid here.`)) return;
    setBusy(true); setMessage('');
    try { const result=await apiFetch('/api/payments/withdrawal',{method:'POST',body:{note:''}}); setMessage(result.message||'Withdrawal request recorded.'); refresh(); }
    catch(err) { setMessage(err.message); }
    finally { setBusy(false); }
  };
  const history=data.withdrawals||[];
  return <section className="panel dashboard-feature payout-panel"><h2>Payouts &amp; withdrawals</h2>
    <p className="helper-text">Money is held for a set period after a session, then becomes available. Requesting a withdrawal records your request only. The platform owner then pays it manually from its bank or payment dashboard and marks it paid here. This product does not send a transfer or promise escrow.</p>
    <div className="stats-grid payout-stats"><StatCard icon={Wallet} label="Held" value={money(metrics.payoutHeldKobo)}/><StatCard icon={CheckCircle2} label="Available to request" value={money(metrics.payoutAvailableKobo)}/><StatCard icon={Clock3} label="Requested, awaiting payment" value={money(metrics.payoutRequestedKobo)}/><StatCard icon={Banknote} label="Paid out" value={money(metrics.payoutPaidKobo)}/></div>
    <div className="booking-actions"><button className="button button-primary" type="button" disabled={busy||available<=0n} onClick={request}>{busy?'Recording…':'Request withdrawal'}</button></div>
    {available<=0n&&<p className="helper-text">Nothing is available to request yet. Money becomes available only after the hold period and the completed-session checks.</p>}
    {message&&<p className="inline-admin-message" role="status">{message}</p>}
    <h3>Request history</h3>
    {history.length?history.map((item)=><div className="listing-row" key={item.id}><span><strong>{money(item.amount_kobo)}</strong><small>Requested {dateTime(item.requested_at)}{item.paid_at?` · paid ${dateTime(item.paid_at)}`:''}{item.payment_reference?` · reference ${item.payment_reference}`:''}{item.status==='rejected'&&item.review_reason?` · ${item.review_reason}`:''}</small></span><StatusBadge value={item.status}/></div>):<p className="empty-inline">No withdrawal requests yet.</p>}
  </section>;
}

function AdminDashboard() {
  const {data,loading,error,refresh}=useDashboard('admin');
  const [message,setMessage]=useState('');
  const [workingId,setWorkingId]=useState('');
  if(loading)return <div className="dashboard-page wrap"><LoadingPanel text="Loading admin operations…"/></div>;
  if(error)return <div className="dashboard-page wrap"><DashboardHeader title="Admin operations" subtitle="Review queues, disputes and live payment state."/><DashboardError error={error}/></div>;
  const metrics=data.metrics||{};const queues=data.queues||{};
  const review=async(kind,item,decision)=>{
    const reason=window.prompt(`Audit reason for ${decision.replaceAll('_',' ')} (${item.title||item.public_display_name||item.id}):`);
    if(!reason||reason.trim().length<5)return;
    setWorkingId(item.id||item.user_id);setMessage('');
    try{
      const route=kind==='listing'?'/api/admin/listings/review':'/api/admin/hosts/review';
      const body=kind==='listing'?{listingId:item.id,decision,reason}:{hostUserId:item.user_id,decision,reason};
      await apiFetch(route,{method:'POST',body});setMessage(`${kind==='listing'?'Listing':'Host'} review recorded.`);refresh();
    }catch(err){setMessage(err.message);}finally{setWorkingId('');}
  };
  const resolve=async(dispute,decision)=>{
    const reason=window.prompt(`Audit reason for ${decision.replaceAll('_',' ')}:`);
    if(!reason||reason.trim().length<5)return;
    let refundAmountKobo=0;
    if(decision==='refund_full')refundAmountKobo=Number(dispute.total_amount_kobo||0);
    if(['refund_partial','split'].includes(decision)){
      const naira=window.prompt('Refund amount in NGN (up to 2 decimal places). This records a provider action; it does not send funds.');
      if(naira===null)return;
      try{refundAmountKobo=Number(parseNairaToKobo(naira));}catch(err){window.alert(err.message);return;}
    }
    setWorkingId(dispute.id);setMessage('');
    try{const result=await apiFetch('/api/admin/disputes/resolve',{method:'POST',body:{disputeId:dispute.id,decision,reason,refundAmountKobo}});setMessage(result.payment_action==='refund_pending_provider_confirmation'?'Decision recorded. Provider refund is still pending; no transfer is claimed.':'Dispute decision recorded; payout remains held.');refresh();}
    catch(err){setMessage(err.message);}finally{setWorkingId('');}
  };
  const reviewChange=async(item,decision)=>{
    const reason=window.prompt(`Audit reason for ${decision} (${item.listing?.title||'listing'}):`);
    if(!reason||reason.trim().length<5)return;
    setWorkingId(item.id);setMessage('');
    try{
      await apiFetch('/api/admin/listings/change-review',{method:'POST',body:{changeRequestId:item.id,decision,reason}});
      setMessage(decision==='approve'?'Change approved and now live. Existing bookings keep their original prices.':'Change rejected. The live listing is unchanged.');refresh();
    }catch(err){setMessage(err.message);}finally{setWorkingId('');}
  };
  const reviewWithdrawal=async(item,decision)=>{
    const reason=window.prompt(`Audit reason for ${decision.replaceAll('_',' ')} (${money(item.amount_kobo)}):`);
    if(!reason||reason.trim().length<5)return;
    let paymentReference='';
    if(decision==='mark_paid'){
      paymentReference=(window.prompt('Payment reference from your bank or Paystack dashboard. Only enter this after you have sent the money yourself:')||'').trim();
      if(paymentReference.length<3)return;
      if(!window.confirm(`Mark ${money(item.amount_kobo)} as paid with reference ${paymentReference}? This records a payment you made outside the app. The app sends no money.`))return;
    }
    setWorkingId(item.id);setMessage('');
    try{
      const result=await apiFetch('/api/admin/withdrawals/review',{method:'POST',body:{requestId:item.id,decision,reason,paymentReference}});
      setMessage(result.status==='paid'?'Marked paid. This records a payment you made outside the app; no money was sent by the app.':`Withdrawal ${result.status}. No money was sent by the app.`);refresh();
    }catch(err){setMessage(err.message);}finally{setWorkingId('');}
  };
  const recordCompanyWithdrawal=async()=>{
    if(BigInt(metrics.commissionAvailableKobo||0)<=0n)return;
    if(!window.confirm(`Record a company withdrawal of ${money(metrics.commissionAvailableKobo)}? This only records the request. You pay it yourself, then mark it paid in the withdrawal queue.`))return;
    setMessage('');
    try{const result=await apiFetch('/api/payments/withdrawal',{method:'POST',body:{scope:'platform',note:'Company commission withdrawal'}});setMessage(result.message||'Company withdrawal recorded.');refresh();}
    catch(err){setMessage(err.message);}
  };
  const withdrawalItems=(queues.withdrawals||[]).filter((item)=>['pending','approved','paid'].includes(item.status)).slice(0,40);
  return <div className="dashboard-page wrap"><DashboardHeader title="Admin operations" subtitle="Live database queues; all review and dispute actions are audited."/>
    <div className="stats-grid"><StatCard icon={FileImage} label="Listing review queue" value={metrics.listingReviewQueue}/><StatCard icon={BadgeCheck} label="Host review queue" value={metrics.hostReviewQueue}/><StatCard icon={CalendarDays} label="Booking records" value={metrics.bookings}/><StatCard icon={Banknote} label="Captured payments" value={money(metrics.capturedPaymentsKobo)}/><StatCard icon={MessageSquare} label="Open disputes" value={metrics.openDisputes}/><StatCard icon={Wallet} label="Held payouts" value={metrics.payoutHeld}/><StatCard icon={Shield} label="Late payments to review" value={metrics.latePaidBookings}/><StatCard icon={Mail} label="New contact messages" value={metrics.contactQueue}/></div>
    <section className="panel dashboard-feature company-commission-panel"><h2>Company commission (platform share)</h2>
      <p className="helper-text">This is the platform's share, kept separate from host money. Commission becomes available on the same schedule as host payouts, and refunded bookings never count. Recording a company withdrawal does not send money; you pay it yourself and then mark it paid.</p>
      <div className="stats-grid"><StatCard icon={Banknote} label="Commission earned" value={money(metrics.commissionEarnedKobo)}/><StatCard icon={CheckCircle2} label="Available to withdraw" value={money(metrics.commissionAvailableKobo)}/><StatCard icon={Clock3} label="Requested, awaiting payment" value={money(metrics.commissionRequestedKobo)}/><StatCard icon={Wallet} label="Withdrawn (marked paid)" value={money(metrics.commissionWithdrawnKobo)}/></div>
      <div className="booking-actions"><button className="button button-primary" type="button" disabled={BigInt(metrics.commissionAvailableKobo||0)<=0n} onClick={recordCompanyWithdrawal}>Record company withdrawal</button></div>
    </section>
    {message&&<p className="inline-admin-message" role="status">{message}</p>}
    <div className="admin-queues">
      <QueuePanel title="Listings pending review" empty="No submitted listings.">{(queues.listings||[]).map((item)=><div className="admin-queue-item" key={item.id}><strong>{item.title}</strong><small>{[item.neighbourhood,item.city].filter(Boolean).join(', ')} · host {item.owner_id.slice(0,8)}</small><div className="booking-actions"><button className="button button-primary button-small" disabled={workingId===item.id} onClick={()=>review('listing',item,'approve')}>Approve</button><button className="button button-secondary button-small" disabled={workingId===item.id} onClick={()=>review('listing',item,'request_changes')}>Request changes</button><button className="button button-secondary button-small" disabled={workingId===item.id} onClick={()=>review('listing',item,'reject')}>Reject</button></div></div>)}</QueuePanel>
      <QueuePanel title="Hosts pending review" empty="No host applications.">{(queues.hosts||[]).map((item)=><div className="admin-queue-item" key={item.user_id}><strong>{item.public_display_name||'Host profile'}</strong><small>Host id {item.user_id.slice(0,8)} · {displayStatus(item.verification_status)}</small><div className="booking-actions"><button className="button button-primary button-small" disabled={workingId===item.user_id} onClick={()=>review('host',item,'approve')}>Approve</button><button className="button button-secondary button-small" disabled={workingId===item.user_id} onClick={()=>review('host',item,'request_changes')}>Request changes</button><button className="button button-secondary button-small" disabled={workingId===item.user_id} onClick={()=>review('host',item,'reject')}>Reject</button></div></div>)}</QueuePanel>
      <QueuePanel title="Listing change requests" empty="No pending change requests to a live listing.">{(queues.listingChanges||[]).map((item)=><div className="admin-queue-item" key={item.id}><strong>{item.listing?.title||'Listing'}</strong><small>Requested {dateTime(item.created_at)} · host {item.requested_by.slice(0,8)}</small><p>{item.reason}</p><ChangeDiff listing={item.listing} proposed={item.proposed_changes}/><div className="booking-actions"><button className="button button-primary button-small" disabled={workingId===item.id} onClick={()=>reviewChange(item,'approve')}>Approve change</button><button className="button button-secondary button-small" disabled={workingId===item.id} onClick={()=>reviewChange(item,'reject')}>Reject</button></div></div>)}</QueuePanel>
      <QueuePanel title="Withdrawal requests" empty="No withdrawal requests to review.">{withdrawalItems.map((item)=><div className="admin-queue-item" key={item.id}><strong>{money(item.amount_kobo)} · {item.requester_role==='platform'?'Company commission':'Host payout'}</strong><small>Requested {dateTime(item.requested_at)} · requester {item.requester_id.slice(0,8)}{item.payment_reference?` · reference ${item.payment_reference}`:''}</small>{item.note&&<p>{item.note}</p>}<StatusBadge value={item.status}/><div className="booking-actions">{item.status==='pending'&&<button className="button button-primary button-small" disabled={workingId===item.id} onClick={()=>reviewWithdrawal(item,'approve')}>Approve</button>}{item.status==='approved'&&<button className="button button-primary button-small" disabled={workingId===item.id} onClick={()=>reviewWithdrawal(item,'mark_paid')}>Mark paid (I paid it)</button>}{['pending','approved'].includes(item.status)&&<button className="button button-secondary button-small" disabled={workingId===item.id} onClick={()=>reviewWithdrawal(item,'reject')}>Reject and release</button>}</div></div>)}</QueuePanel>
      <QueuePanel title="Dispute queue" empty="No disputes are recorded.">{(queues.disputes||[]).filter((item)=>!['resolved','closed'].includes(item.status)).map((item)=><div className="admin-queue-item" key={item.id}><strong>{displayStatus(item.dispute_type)} · {displayStatus(item.status)}</strong><small>{item.description}</small><div className="booking-actions"><button className="button button-secondary button-small" onClick={()=>resolve(item,'request_more_evidence')}>Request evidence</button><button className="button button-primary button-small" onClick={()=>resolve(item,'release_payout')}>Resolve: no refund</button><button className="button button-secondary button-small" onClick={()=>resolve(item,'refund_full')}>Record full refund</button><button className="button button-secondary button-small" onClick={()=>resolve(item,'refund_partial')}>Record partial refund</button></div><p className="helper-text">Refund and payout provider actions are not automated here.</p></div>)}</QueuePanel>
      <QueuePanel title="Recent provider payments" empty="No payment attempts recorded.">{(queues.payments||[]).slice(0,12).map((item)=><div className="listing-row" key={item.id}><span><strong>{money(item.amount_kobo)}</strong><small>{item.provider_reference} · booking {item.booking_id.slice(0,8)}</small></span><StatusBadge value={item.status}/></div>)}</QueuePanel>
      <QueuePanel title="Contact requests" empty="No contact submissions.">{(queues.contacts||[]).slice(0,15).map((item)=><div className="admin-queue-item" key={item.id}><strong>{item.subject}</strong><small>{item.full_name} · {item.email} · {dateTime(item.created_at)}</small><p>{item.message}</p><StatusBadge value={item.status}/></div>)}</QueuePanel>
    </div>
    <p className="helper-text">Metrics are bounded to the latest records returned by this admin view; they are not financial reconciliation. Keep provider statements and database records reconciled before launch.</p>
  </div>;
}
function QueuePanel({title,empty,children}) { const hasItems=Array.isArray(children)?children.length>0:Boolean(children);return <section className="panel queue-panel"><h2>{title}</h2>{hasItems?children:<p className="empty-inline">{empty}</p>}</section>; }

const onboardingSteps=['Host profile','Space details','Location & rules','Availability','Photos & submit'];
// Host statuses that the create_listing_draft database function accepts.
const ADDABLE_HOST_STATUSES=['pending','approved','needs_changes'];
// mode='onboarding' (default): first-time host application, starts at the host-profile step.
// mode='new-listing': an existing host adds another space. Skips the host-profile step and never calls /api/host/onboarding.
function HostOnboarding({mode='onboarding'}) {
  const navigate=useNavigate();
  const toast=useToast();
  const isNewListing=mode==='new-listing';
  const firstStep=isNewListing?1:0;
  const [step,setStep]=useState(firstStep);
  const [hostGate,setHostGate]=useState({loading:isNewListing,host:null,error:''});
  const [form,setForm]=useState({displayName:'',bio:'',title:'',category:'Creative Studio',description:'',city:'',neighbourhood:'',publicLocation:'',exactAddress:'',hourlyRateNaira:'',minHours:'2',capacity:'12',rules:'',termsAccepted:false});
  const [amenityCatalog,setAmenityCatalog]=useState([]);
  const [selectedAmenities,setSelectedAmenities]=useState([]);
  const [photos,setPhotos]=useState([]);
  const [availability,setAvailability]=useState(Array.from({length:7},(_,weekday)=>({weekday,enabled:false,opens_at:'09:00',closes_at:'18:00'})));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [submitted,setSubmitted]=useState(null);
  const [listingId,setListingId]=useState('');
  const [settings,setSettings]=useState(null);
  useEffect(()=>{apiFetch('/api/amenities').then((result)=>setAmenityCatalog(result.amenities||[])).catch(()=>setAmenityCatalog([]));apiFetch('/api/settings').then(setSettings).catch(()=>setSettings(null));},[]);
  useEffect(()=>{
    if(!isNewListing)return undefined;
    let active=true;
    apiFetch('/api/dashboard?role=host').then((data)=>{if(active)setHostGate({loading:false,host:data.host||null,error:''});}).catch((err)=>{if(active)setHostGate({loading:false,host:null,error:err.message});});
    return()=>{active=false;};
  },[isNewListing]);
  const update=(key,value)=>setForm((current)=>({...current,[key]:value}));
  const toggleAmenity=(id)=>setSelectedAmenities((current)=>current.includes(id)?current.filter((value)=>value!==id):[...current,id]);
  const selectPhotos=(files)=>{
    const chosen=Array.from(files||[]);
    const valid=chosen.filter((file)=>['image/jpeg','image/png','image/webp'].includes(file.type)&&file.size<=10*1024*1024);
    setPhotos(valid.slice(0,8));
    if(valid.length!==chosen.length)setError('Photos must be JPG, PNG or WebP and no larger than 10 MB each.');else setError('');
  };
  const submit=async()=>{
    setError('');setBusy(true);
    try{
      if(!supabase)throw new Error('Database storage is not configured. No listing draft was created.');
      // Existing hosts must not re-run request_host_role, so the onboarding call happens only in the first-time flow.
      let hostStatus=hostGate.host?.verification_status||'';
      if(!isNewListing){const onboarding=await apiFetch('/api/host/onboarding',{method:'POST',body:{displayName:form.displayName,bio:form.bio,termsAccepted:form.termsAccepted}});hostStatus=onboarding.verification_status;}
      let createdId=listingId;
      if(!createdId){
        const draft=await apiFetch('/api/host/listings',{method:'POST',body:{
          title:form.title,category:form.category,description:form.description,city:form.city,neighbourhood:form.neighbourhood,
          publicLocation:form.publicLocation,exactAddress:form.exactAddress,hourlyRateKobo:Number(parseNairaToKobo(form.hourlyRateNaira)),
          minHours:Number(form.minHours),crewCapacity:Number(form.capacity),houseRules:form.rules.split('\n').map((item)=>item.trim()).filter(Boolean),
          amenityIds:selectedAmenities,availability:availability.filter((item)=>item.enabled).map(({weekday,opens_at,closes_at})=>({weekday,opens_at,closes_at})),
        }});
        createdId=draft.id;setListingId(createdId);
      }
      if(!photos.length)throw new Error('Add at least one real location photo before submission.');
      const {data:{user}}=await supabase.auth.getUser();
      if(!user)throw new Error('Sign in before uploading listing photos.');
      for(let index=0;index<photos.length;index+=1){
        const file=photos[index];const extension=file.type==='image/jpeg'?'jpg':file.type==='image/png'?'png':'webp';
        const path=`${createdId}/${crypto.randomUUID()}.${extension}`;
        const upload=await supabase.storage.from('listing-photos').upload(path,file,{contentType:file.type,upsert:false});
        if(upload.error)throw upload.error;
        await apiFetch('/api/host/listings/photo',{method:'POST',body:{listingId:createdId,storagePath:path,altText:`${form.title} location photo ${index+1}`,isCover:index===0}});
      }
      const result=await apiFetch('/api/host/listings/submit',{method:'POST',body:{listingId:createdId}});
      setSubmitted({listingId:createdId,status:result.status,hostStatus});
    }catch(err){setError(err.message||'Host application could not be saved.');}
    finally{setBusy(false);}
  };
  const next=()=>{
    setError('');
    if(step===0&&(!form.displayName.trim()||!form.termsAccepted)){setError('Add a host display name and acknowledge the submission terms.');return;}
    if(step===1&&(!form.title.trim()||form.title.trim().length<4||!form.category||!form.description.trim()||Number(form.hourlyRateNaira)<=0||Number(form.capacity)<1)){setError('Complete the required space details, rate and capacity.');return;}
    if(step===2&&(!form.city.trim()||!form.neighbourhood.trim()||!form.exactAddress.trim())){setError('City, neighbourhood and private exact address are required.');return;}
    if(step===3&&!availability.some((item)=>item.enabled)){setError('Choose at least one regular availability window.');return;}
    if(step<onboardingSteps.length-1)setStep((value)=>value+1);else submit();
  };
  const schedule=availability.map((item)=>({...item,label:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][item.weekday]}));
  if(isNewListing&&hostGate.loading)return <div className="page-wrap wrap onboarding-page"><LoadingPanel text="Checking your host profile…"/></div>;
  if(isNewListing&&(hostGate.error||!hostGate.host))return <div className="page-wrap wrap onboarding-page"><DashboardHeader title="Add another space" subtitle="Adding a space needs an existing host profile."/><EmptyPanel title="No host profile found" text={hostGate.error||'Apply to become a host first. Once your host profile exists you can add spaces from your dashboard.'} action={<Link className="button button-primary" to="/host/onboarding">Start host application</Link>}/></div>;
  if(isNewListing&&!ADDABLE_HOST_STATUSES.includes(hostGate.host.verification_status))return <div className="page-wrap wrap onboarding-page"><DashboardHeader title="Add another space" subtitle="Your host account cannot add spaces right now."/><EmptyPanel title="Host account not active" text={`Your host status is ${displayStatus(hostGate.host.verification_status)}. Contact the platform owner if you think this is wrong.`} action={<Link className="button button-secondary" to="/host-dashboard">Back to host dashboard</Link>}/></div>;
  if(submitted)return <div className="page-wrap wrap onboarding-page"><DashboardHeader title={isNewListing?'Space submitted':'Host application submitted'} subtitle="The records are saved but are not published or bookable."/><div className="panel publish-complete"><div className="confirmed-icon"><CheckCircle2 size={30}/></div><h2>{form.title} · pending review</h2><p>Listing status: <strong>{displayStatus(submitted.status)}</strong>. Host status: <strong>{displayStatus(submitted.hostStatus)}</strong>. An administrator must review {isNewListing?'this new space':'the host, listing and photos'} before public discovery.</p><div className="button-row"><Link to="/host-dashboard" className="button button-primary">Back to host dashboard</Link><Link to="/explore" className="button button-secondary">Browse published spaces</Link></div></div></div>;
  const visibleSteps=onboardingSteps.length-firstStep;
  return <div className="page-wrap wrap onboarding-page"><DashboardHeader title={isNewListing?'Add another space':'Host onboarding'} subtitle={isNewListing?'Submit a real additional location for review. Saving this form does not publish it.':'Submit your real location for review. Saving this form does not publish it.'}/>
    <div className="onboarding-steps">{onboardingSteps.map((item,index)=>index<firstStep?null:<button key={item} type="button" className={`${index===step?'active':''}${index<step?' complete':''}`} onClick={()=>index<=step&&setStep(index)}><span>{index+1-firstStep}.</span> {item}</button>)}</div>
    <section className="panel onboarding-panel"><div className="onboarding-step-title"><span>STEP {String(step+1-firstStep).padStart(2,'0')} / {String(visibleSteps).padStart(2,'0')}</span><h2>{onboardingSteps[step]}</h2></div><div className="onboarding-form">
      {step===0&&<><div className="form-grid"><label className="form-field"><span>Public host name</span><input required maxLength={120} value={form.displayName} onChange={(event)=>update('displayName',event.target.value)} placeholder="Name shown to booking participants"/></label><label className="form-field"><span>Short host bio</span><input maxLength={3000} value={form.bio} onChange={(event)=>update('bio',event.target.value)} placeholder="Tell creators about your experience"/></label></div><label className="remember-check terms-check"><input type="checkbox" checked={form.termsAccepted} onChange={(event)=>update('termsAccepted',event.target.checked)}/> I am submitting a host application and understand it is subject to review; host terms remain a draft until owner/legal approval. <Link to="/terms">View draft</Link></label></>}
      {step===1&&<><div className="form-grid"><label className="form-field"><span>Space name</span><input required minLength={4} maxLength={120} value={form.title} onChange={(event)=>update('title',event.target.value)} placeholder="A name for your real location"/></label><label className="form-field"><span>Category</span><select value={form.category} onChange={(event)=>update('category',event.target.value)}>{categories.map((item)=><option key={item}>{item}</option>)}</select></label><label className="form-field"><span>Hourly rate per person (NGN)</span><input required type="number" min="1" step="500" value={form.hourlyRateNaira} onChange={(event)=>update('hourlyRateNaira',event.target.value)} placeholder="Set your real rate"/></label><label className="form-field"><span>Minimum booking hours</span><select value={form.minHours} onChange={(event)=>update('minHours',event.target.value)}>{Array.from({length:24},(_,index)=>index+1).map((value)=><option key={value}>{value}</option>)}</select></label><label className="form-field"><span>Maximum crew capacity</span><input required type="number" min="1" max="500" value={form.capacity} onChange={(event)=>update('capacity',event.target.value)}/></label></div><label className="form-field"><span>Listing description</span><textarea rows="4" maxLength={5000} value={form.description} onChange={(event)=>update('description',event.target.value)} placeholder="Describe the actual space, its permitted production uses and limitations."/></label></>}
      {step===2&&<><div className="form-grid"><label className="form-field"><span>City</span><input required maxLength={100} value={form.city} onChange={(event)=>update('city',event.target.value)} placeholder="City"/></label><label className="form-field"><span>Neighbourhood</span><input required maxLength={120} value={form.neighbourhood} onChange={(event)=>update('neighbourhood',event.target.value)} placeholder="Neighbourhood"/></label><label className="form-field"><span>Public area description</span><input maxLength={250} value={form.publicLocation} onChange={(event)=>update('publicLocation',event.target.value)} placeholder="General area only; no door or unit number"/></label></div><label className="form-field"><span>Exact address · private</span><textarea required rows="2" maxLength={500} value={form.exactAddress} onChange={(event)=>update('exactAddress',event.target.value)} placeholder="Exact address stored privately; it is not returned by public discovery."/></label><label className="form-field"><span>House rules · one per line</span><textarea rows="3" maxLength={3000} value={form.rules} onChange={(event)=>update('rules',event.target.value)} placeholder="Only enter real, applicable rules."/></label><div className="onboarding-amenities">{amenityCatalog.map((item)=><label className={`amenity-choice${selectedAmenities.includes(item.id)?' selected':''}`} key={item.id}><input type="checkbox" checked={selectedAmenities.includes(item.id)} onChange={()=>toggleAmenity(item.id)}/><CheckCircle2 size={15}/>{item.name}</label>)}</div>{!amenityCatalog.length&&<p className="helper-text">Connect the database to load the owner-managed amenity catalogue.</p>}<p className="helper-text">Exact addresses and host contact details are not shown in public discovery. They are available only to booking participants after verified payment.</p></>}
      {step===3&&<><p className="helper-text">Set recurring weekly hours in Africa/Lagos time. The server will reject requests outside these hours or overlapping confirmed/pending records.</p><div className="availability-editor">{schedule.map((item)=>{const current=availability[item.weekday];return <div className="availability-day" key={item.weekday}><label className="remember-check"><input type="checkbox" checked={current.enabled} onChange={(event)=>setAvailability((rows)=>rows.map((row)=>row.weekday===item.weekday?{...row,enabled:event.target.checked}:row))}/>{item.label}</label><input type="time" disabled={!current.enabled} value={current.opens_at} onChange={(event)=>setAvailability((rows)=>rows.map((row)=>row.weekday===item.weekday?{...row,opens_at:event.target.value}:row))}/><span>to</span><input type="time" disabled={!current.enabled} value={current.closes_at} onChange={(event)=>setAvailability((rows)=>rows.map((row)=>row.weekday===item.weekday?{...row,closes_at:event.target.value}:row))}/></div>;})}</div></>}
      {step===4&&<><label className="upload-drop"><Upload size={22}/><strong>Upload real listing photos</strong><span>JPG, PNG or WebP · up to 10 MB each · private until review</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event)=>selectPhotos(event.target.files)}/></label>{photos.length>0&&<div className="uploaded-list">{photos.map((file)=><span key={`${file.name}-${file.lastModified}`}><FileImage size={14}/>{file.name}</span>)}</div>}<div className="review-summary"><h3>Review before submission</h3><p><CheckCircle2 size={14}/>{form.title||'Space name pending'}</p><p><CheckCircle2 size={14}/>{[form.neighbourhood,form.city].filter(Boolean).join(', ')||'Location pending'}</p><p><CheckCircle2 size={14}/>{photos.length} real photo{photos.length===1?'':'s'} selected</p><p><CheckCircle2 size={14}/>{availability.filter((item)=>item.enabled).length} weekly availability window{availability.filter((item)=>item.enabled).length===1?'':'s'}</p></div><p className="draft-policy-notice">Your host application starts as pending. Photos remain private until approval. Do not upload third-party or unlicensed images.</p></>}
    </div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="onboarding-actions">{step>firstStep&&<button className="button button-secondary" type="button" onClick={()=>setStep((value)=>value-1)}><ChevronLeft size={15}/> Back</button>}<button className="button button-primary" type="button" disabled={busy||(step===4&&!photos.length)} onClick={next}>{busy?'Saving real records…':step===4?'Submit for review':'Continue'} <ArrowRight size={15}/></button></div>
    {settings&&!settings.bookingEnabled&&<p className="helper-text">Booking and payment remain disabled until the owner configures policy and provider settings.</p>}
    </section>
  </div>;
}

export function OtpRoomPage() {
  const [params]=useSearchParams();
  const bookingId=params.get('bookingId');
  const {booking,viewerRole,error,loading,refresh}=useBookingDetails(bookingId);
  const [code,setCode]=useState('');
  const [message,setMessage]=useState('');
  const [working,setWorking]=useState(false);
  const issue=async()=>{
    setWorking(true);setMessage('');
    try{const result=await apiFetch('/api/bookings/otp',{method:'POST',body:{action:'issue',bookingId}});setMessage(`Your one-time code is ${result.code}. It expires ${dateTime(result.expires_at)}. It will not be saved for later.`);}
    catch(err){setMessage(err.message);}
    finally{setWorking(false);}
  };
  const verify=async(event)=>{
    event.preventDefault();setWorking(true);setMessage('');
    try{const result=await apiFetch('/api/bookings/otp',{method:'POST',body:{action:'verify',bookingId,code}});setMessage(result.verified?'Check-in verified by the server. Booking status is now checked in.':`Code not accepted: ${result.reason||'try again or contact the booking owner'}.`);setCode('');refresh();}
    catch(err){setMessage(err.message);}
    finally{setWorking(false);}
  };
  const complete=async(action)=>{
    setWorking(true);setMessage('');
    try{const result=await apiFetch('/api/bookings/completion',{method:'POST',body:{action,bookingId}});setMessage(`Status updated to ${displayStatus(result.booking_status)}. Payout remains held.`);refresh();}
    catch(err){setMessage(err.message);}
    finally{setWorking(false);}
  };
  if(!bookingId)return <div className="page-wrap wrap"><EmptyPanel title="Choose a booking first" text="Open this room from an eligible booking in your creator or host dashboard." action={<Link className="button button-primary" to="/creator-dashboard">Creator dashboard</Link>}/></div>;
  if(loading)return <div className="page-wrap wrap"><LoadingPanel text="Loading private booking details…"/></div>;
  if(error)return <div className="page-wrap wrap"><DashboardError error={error}/></div>;
  if(!booking)return <div className="page-wrap wrap"><EmptyPanel title="Booking details unavailable" text="The booking could not be loaded for this account. It may have been removed, or you may not be a participant." action={<Link className="button button-primary" to="/creator-dashboard">Creator dashboard</Link>}/></div>;
  const isCreator=viewerRole==='creator';
  const isHost=viewerRole==='host';
  const canGenerate=!viewerRole||isCreator;
  const canVerify=!viewerRole||isHost;
  return <div className="page-wrap wrap otp-room-page"><div className="panel otp-room-intro"><p className="eyebrow">Booking check-in room</p><h1>{booking.public_code||'Booking'}</h1><p>Private arrival information is visible only to booking participants after server-verified payment. Check-in is separate from completion and payout.</p></div><div className="otp-room-grid">
    <section className="panel crew-summary"><h2>Booking details</h2><p><span>Location:</span> {booking.listing?.title||booking.listing_title_snapshot||'Production location'}</p><p><span>Arrival address:</span> {booking.listing?.exact_address||'Shared with booking participants after payment confirmation.'}</p><p><span>Host:</span> {booking.host?.public_display_name||'Host'}</p><p><span>Start:</span> {dateTime(booking.starts_at)}</p><p><span>End:</span> {dateTime(booking.ends_at)}</p><p><span>Production:</span> {booking.production_type||'Production'}{booking.crew_size?` · ${booking.crew_size} crew`:''}</p><p><span>Booking state:</span> <StatusBadge value={booking.booking_status}/></p><p><span>Payment state:</span> <StatusBadge value={booking.payment_status}/></p><p><span>Payout state:</span> <StatusBadge value={booking.payout_status}/></p></section>
    <section className="panel otp-control"><p>Only the creator can issue the booking-specific, expiring code. The host enters it here. Codes are hashed server-side and are never logged or saved in plaintext.</p>
      {canGenerate&&<button type="button" className="button button-secondary button-block" disabled={working||booking.booking_status!=='confirmed'} onClick={issue}>Generate a creator check-in code</button>}
      {canVerify&&<form onSubmit={verify}><label className="form-field"><span>Host: enter the creator's six-digit code</span><input className="otp-input" value={code} onChange={(event)=>setCode(event.target.value.replace(/\D/g,'').slice(0,6))} maxLength={6} inputMode="numeric" autoComplete="one-time-code" aria-label="Six-digit check-in code" placeholder="000000"/></label><button className="button button-primary button-block" type="submit" disabled={working||code.length!==6||booking.booking_status!=='confirmed'}>Verify check-in</button></form>}
      {booking.booking_status==='checked_in'&&(!viewerRole||isHost)&&<button type="button" className="button button-primary button-block" disabled={working} onClick={()=>complete('host_submit')}>Host: submit session completion</button>}
      {booking.booking_status==='completion_pending'&&(!viewerRole||isCreator)&&<button type="button" className="button button-secondary button-block" disabled={working} onClick={()=>complete('creator_confirm')}>Creator: confirm completion</button>}
      {message&&<p className="inline-operation-message" role="status">{message}</p>}
      <div className="status-panel"><small>Payment</small><strong>{displayStatus(booking.payment_status)}</strong><small>Payout</small><strong>{displayStatus(booking.payout_status)}</strong><small>Check-in alone never releases a payout. Open disputes keep funds held.</small></div>
      {booking.id&&<Link className="text-link" to={`/dispute?bookingId=${encodeURIComponent(booking.id)}`}>Open a dispute for this booking</Link>}
    </section></div></div>;
}
function useBookingDetails(bookingId) {
  const [state,setState]=useState({booking:null,viewerRole:null,loading:Boolean(bookingId),error:''});
  const [version,setVersion]=useState(0);
  const refresh=()=>setVersion((value)=>value+1);
  useEffect(()=>{let active=true;if(!bookingId){setState({booking:null,viewerRole:null,loading:false,error:''});return undefined;}setState({booking:null,viewerRole:null,loading:true,error:''});apiFetch(`/api/bookings/${encodeURIComponent(bookingId)}`).then((result)=>{if(active)setState({booking:result?.booking||null,viewerRole:result?.viewerRole||null,loading:false,error:''});}).catch((error)=>{if(active)setState({booking:null,viewerRole:null,loading:false,error:error?.message||'Booking details could not be loaded.'});});return()=>{active=false;};},[bookingId,version]);
  return {...state,refresh};
}

function ContactPage() {
  const [form,setForm]=useState({fullName:'',email:'',phone:'',subject:'',message:'',consent:false,website:''});
  const [sent,setSent]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const submit=async(event)=>{
    event.preventDefault();setError('');setBusy(true);
    try{const result=await apiFetch('/api/contact',{method:'POST',body:form});setSent(result);}
    catch(err){setError(err.message);}
    finally{setBusy(false);}
  };
  return <div className="page-wrap wrap contact-page"><div className="contact-layout"><div className="contact-main"><p className="eyebrow">Contact ShootSpace Africa</p><h1>Talk to the founder</h1><p className="contact-lede">For booking questions, host onboarding, partnerships or operational issues. Contact form delivery depends on owner-configured database and email services; direct channels are shown here.</p>
    <div className="contact-cards"><a href={`mailto:${publicSettings.email}`} className="panel contact-method"><span className="contact-icon"><Mail size={20}/></span><strong>Email</strong><span>{publicSettings.email}</span></a><a href={`tel:${publicSettings.phoneE164}`} className="panel contact-method"><span className="contact-icon"><Phone size={20}/></span><strong>Phone</strong><span>{publicSettings.phoneDisplay} · {publicSettings.phoneE164}</span></a><a href={publicSettings.whatsappUrl} target="_blank" rel="noreferrer" className="panel contact-method"><span className="contact-icon"><MessageSquare size={20}/></span><strong>WhatsApp</strong><span>Message ShootSpace Africa</span></a></div>
    <form className="panel contact-form" onSubmit={submit}><h2>Send an enquiry</h2>{sent?<div className="inline-success"><CheckCircle2 size={21}/><div><strong>Contact request saved</strong><p>{sent.emailSent?'Notification email accepted by configured provider.':'Email notification is not configured or did not send. Use the direct contact channels above if the issue is urgent.'}</p>{sent.reference&&<small>Reference: {sent.reference}</small>}</div></div>:<><div className="form-grid"><input required maxLength={120} placeholder="Full name" value={form.fullName} onChange={(event)=>setForm({...form,fullName:event.target.value})}/><input required maxLength={254} type="email" placeholder="Email address" value={form.email} onChange={(event)=>setForm({...form,email:event.target.value})}/><input maxLength={40} placeholder="Phone (optional)" type="tel" value={form.phone} onChange={(event)=>setForm({...form,phone:event.target.value})}/><input required maxLength={160} placeholder="Subject" value={form.subject} onChange={(event)=>setForm({...form,subject:event.target.value})}/></div><textarea required minLength={10} maxLength={10000} placeholder="Tell us what you need help with" value={form.message} onChange={(event)=>setForm({...form,message:event.target.value})}/><label className="honeypot-field" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(event)=>setForm({...form,website:event.target.value})}/></label><label className="remember-check"><input type="checkbox" required checked={form.consent} onChange={(event)=>setForm({...form,consent:event.target.checked})}/> I consent to this enquiry being stored for a response.</label>{error&&<p className="form-error" role="alert">{error}</p>}<button className="button button-primary" type="submit" disabled={busy}>{busy?'Sending…':'Submit enquiry'} <ArrowRight size={15}/></button></>}</form>
  </div><aside className="contact-aside"><section className="panel office-card"><h2>Direct contact</h2><p>Use the founder-provided channels. No office address or support hours are published here.</p><div className="direct-contact-list"><a href={`tel:${publicSettings.phoneE164}`}><Phone size={15}/>{publicSettings.phoneE164}</a><a href={publicSettings.whatsappUrl} target="_blank" rel="noreferrer"><MessageSquare size={15}/>WhatsApp</a><a href={`mailto:${publicSettings.email}`}><Mail size={15}/>{publicSettings.email}</a></div></section><section className="panel priority-card"><h3>Public profile labels</h3>{publicSettings.instagramUrl?<a href={publicSettings.instagramUrl} target="_blank" rel="noreferrer">Instagram {publicSettings.instagramHandle}</a>:<p>Instagram: {publicSettings.instagramHandle} · profile link awaits confirmation.</p>}{publicSettings.linkedInUrl?<a href={publicSettings.linkedInUrl} target="_blank" rel="noreferrer">LinkedIn {publicSettings.linkedInName}</a>:<p>LinkedIn label: {publicSettings.linkedInName} · no profile URL supplied.</p>}</section></aside></div></div>;
}

function DisputePage() {
  const [params]=useSearchParams();
  const [bookings,setBookings]=useState([]);
  const [loading,setLoading]=useState(true);
  const [form,setForm]=useState({bookingId:params.get('bookingId')||'',type:'host_no_show',description:''});
  const [files,setFiles]=useState([]);
  const [submitted,setSubmitted]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;apiFetch('/api/my-bookings').then((result)=>{if(active)setBookings(result.bookings||[]);}).catch((err)=>{if(active)setError(err.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
  const send=async(event)=>{
    event.preventDefault();setError('');setBusy(true);
    try{
      const result=await apiFetch('/api/bookings/disputes',{method:'POST',body:{bookingId:form.bookingId,type:form.type,description:form.description}});
      let uploaded=0;
      if(files.length){
        if(!supabase)throw new Error('Dispute was created, but private evidence storage is not configured.');
        const {data:{user}}=await supabase.auth.getUser();
        if(!user)throw new Error('Dispute was created, but the user session is unavailable for evidence upload.');
        for(const file of files){
          const ext=(file.name.split('.').pop()||'').toLowerCase().replace(/[^a-z0-9]/g,'');
          const path=`${user.id}/${result.dispute_id}/${crypto.randomUUID()}.${ext}`;
          const upload=await supabase.storage.from('dispute-evidence').upload(path,file,{contentType:file.type,upsert:false});
          if(upload.error)throw upload.error;
          await apiFetch('/api/bookings/dispute-evidence',{method:'POST',body:{disputeId:result.dispute_id,storagePath:path}});uploaded+=1;
        }
      }
      setSubmitted({...result,uploaded});
    }catch(err){setError(err.message||'Dispute was not submitted.');}
    finally{setBusy(false);}
  };
  return <div className="page-wrap wrap dispute-page"><div className="dispute-content"><p className="eyebrow">Dispute centre</p><h1>Open a dispute</h1><p className="dispute-lede">Reports are stored for an authorized operations review. A submitted dispute holds payout eligibility; it does not trigger a refund or transfer.</p>
    {submitted?<div className="panel dispute-form"><div className="inline-success"><CheckCircle2 size={22}/><div><strong>Dispute recorded</strong><p>Reference {submitted.dispute_id}. {submitted.uploaded} evidence file{submitted.uploaded===1?'':'s'} attached. Payout remains held while the dispute is open.</p></div></div><Link className="button button-primary" to="/creator-dashboard">Return to dashboard</Link></div>:<form className="panel dispute-form" onSubmit={send}><label className="field-label" htmlFor="dispute-booking">Select a booking you participate in</label>{loading?<p className="helper-text">Loading your booking records…</p>:<select id="dispute-booking" required value={form.bookingId} onChange={(event)=>setForm({...form,bookingId:event.target.value})}><option value="">Choose booking</option>{bookings.map((booking)=><option key={booking.id} value={booking.id}>{booking.public_code} · {booking.listing_title_snapshot} · {displayStatus(booking.booking_status)}</option>)}</select>}
      <label className="field-label" htmlFor="dispute-type">Dispute type</label><select id="dispute-type" value={form.type} onChange={(event)=>setForm({...form,type:event.target.value})}><option value="host_no_show">Host no-show</option><option value="listing_mismatch">Location mismatch</option><option value="safety_issue">Safety concern</option><option value="property_damage">Property damage</option><option value="payment_issue">Payment issue</option><option value="session_overrun">Session overrun</option><option value="other">Other</option></select>
      <label className="field-label" htmlFor="dispute-description">What happened?</label><textarea id="dispute-description" required minLength={10} maxLength={10000} value={form.description} onChange={(event)=>setForm({...form,description:event.target.value})} placeholder="Provide a factual timeline and details relevant to the booking."/>
      <label className="evidence-upload"><Upload size={16}/><span>Optional evidence · images or PDF, max 10 MB each. Stored in private dispute storage.</span><input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event)=>setFiles(Array.from(event.target.files||[]).filter((file)=>file.size<=10*1024*1024&&['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)).slice(0,5))}/></label>{files.length>0&&<p className="helper-text">{files.length} evidence file{files.length===1?'':'s'} selected. Names are not shown to other visitors.</p>}
      {error&&<p className="form-error" role="alert">{error}</p>}{bookings.length===0&&!loading&&<p className="helper-text">A dispute requires a booking associated with your account.</p>}
      <div className="button-row"><button className="button button-primary" type="submit" disabled={busy||!bookings.length}>{busy?'Saving dispute…':'Submit dispute'} <ArrowRight size={14}/></button><Link className="button button-secondary" to="/creator-dashboard">Cancel</Link></div>
    </form>}
  </div></div>;
}

function PolicyPage({kind}) {
  const [settings,setSettings]=useState(null);
  useEffect(()=>{apiFetch('/api/settings').then(setSettings).catch(()=>setSettings(null));},[]);
  const content={
    terms:{title:'Terms of use',intro:'This is a draft for owner and legal review. It is not an approved contract and does not establish that payments or marketplace services are live.',sections:[['Marketplace status','Listings are shown only from approved database records. A booking request is not a confirmed booking. A host response and, when enabled, provider-confirmed payment are separate states.'],['Payments and payouts','The platform does not claim escrow. Payment processing, refunds, payout timing and supported methods require provider approval and owner configuration. Check-in alone never releases payout.'],['Roles and conduct','Creators, hosts and administrators are subject to role checks, privacy requirements and the policies approved for the live service.'],['Launch requirements','This draft must be reviewed and replaced with owner-approved operating, cancellation and consumer protection terms before launch.']]},
    privacy:{title:'Privacy notice',intro:'DRAFT — owner/privacy counsel review required. Do not treat this text as a final privacy notice or a statement that production services are configured.',sections:[['Data handled by the pilot','Account profile, booking details, host listing details, contact messages and optional dispute evidence may be stored after the owner configures the database. Host verification and dispute evidence are designed for private storage.'],['Location and contact privacy','Exact listing addresses and private host contacts are not included in public discovery. Arrival details are limited to booking participants after a paid booking is server-confirmed.'],['Retention and rights','The owner must document lawful basis, retention, deletion, data subject access, processors, incident handling and any cross-border transfers before collecting live personal or verification data.'],['Third parties','Supabase, payment, email, hosting and analytics providers must be selected, approved, configured and disclosed by the owner. No provider is claimed live by this preview.']]},
    cancellation:{title:'Cancellation & refund policy',intro:'DRAFT — not approved. Booking requests and payment are disabled until the owner/legal reviewer approves and configures the actual policy.',sections:[['Current system behaviour','Before payment, an eligible unpaid request may be cancelled. After verified payment, this build does not automatically cancel or refund; those cases require a configured approved policy and provider operation.'],['Owner configuration','The owner must decide notice windows, cancellations by creators/hosts, no-show outcomes, refunds, partial refunds, fees, dispute holds and the payment provider’s actual refund process. Approved policy text and version are snapshotted when a booking request is created.'],['No escrow claim','The product does not promise escrow or a guaranteed payout/refund. Provider settlement and any refund must be verified independently before communicating a completed outcome.']]},
  }[kind];
  return <div className="page-wrap wrap policy-page"><p className="eyebrow">Policy draft · requires review</p><h1>{content.title}</h1><div className="policy-draft-banner"><Shield size={17}/><span>DRAFT — owner and legal review required before production use.</span></div><p className="policy-intro">{content.intro}</p>{kind==='cancellation'&&settings?.cancellationPolicyApproved&&<div className="panel approved-policy"><strong>Owner-configured policy version: {settings.cancellationPolicyVersion}</strong><p>{settings.cancellationPolicyText}</p></div>}{content.sections.map(([title,text])=><section className="panel policy-section" key={title}><h2>{title}</h2><p>{text}</p></section>)}</div>;
}
function LoadingPanel({text}) { return <div className="panel loading-panel"><span className="loading-dot"/><p>{text}</p></div>; }
function EmptyPanel({title,text,action}) { return <div className="empty-state page-empty"><CircleHelp size={24}/><h3>{title}</h3><p>{text}</p>{action}</div>; }
function NotFound() { return <div className="not-found wrap"><div className="confirmed-icon"><Search size={27}/></div><p className="eyebrow">404 · Out of frame</p><h1>We couldn't find that page.</h1><p>Let's get you back to the published locations.</p><Link className="button button-primary" to="/explore">Explore locations <ArrowRight size={15}/></Link></div>; }

export default App;
