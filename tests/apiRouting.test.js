import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bookingRoutes } from '../api/_lib/endpoints/bookings.js';
import { listingRoutes } from '../api/_lib/endpoints/listings.js';
import { platformRoutes } from '../api/_lib/endpoints/platform.js';
import { accountRoutes } from '../api/_lib/endpoints/account.js';
import { hostRoutes } from '../api/_lib/endpoints/host.js';
import { adminRoutes } from '../api/_lib/endpoints/admin.js';
import { paymentRoutes } from '../api/_lib/endpoints/payments.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const vercelConfig = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));

// Public URLs that must keep resolving after the Hobby-plan regrouping.
const PUBLIC_URLS = [
  '/api/listings', '/api/listings/:slug', '/api/amenities', '/api/availability', '/api/reviews', '/api/settings',
  '/api/me', '/api/dashboard', '/api/favorites', '/api/contact', '/api/my-bookings',
  '/api/bookings/request', '/api/bookings/respond', '/api/bookings/cancel', '/api/bookings/completion',
  '/api/bookings/otp', '/api/bookings/disputes', '/api/bookings/dispute-evidence', '/api/bookings/:id',
  '/api/host/onboarding', '/api/host/verification-document', '/api/host/listings',
  '/api/host/listings/photo', '/api/host/listings/submit',
  '/api/admin/listings/review', '/api/admin/hosts/review', '/api/admin/disputes/resolve',
  '/api/payments/initialize', '/api/payments/status',
];

// Function file -> route table, matching the thin files in api/.
const FUNCTION_TABLES = {
  'api/bookings.js': bookingRoutes,
  'api/listings.js': listingRoutes,
  'api/platform.js': platformRoutes,
  'api/account.js': accountRoutes,
  'api/host.js': hostRoutes,
  'api/admin.js': adminRoutes,
  'api/payments.js': paymentRoutes,
};

function listFiles(directory, predicate = () => true) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return entry === '_lib' ? [] : listFiles(path, predicate);
    return predicate(path) ? [path] : [];
  });
}

function functionFiles() {
  return listFiles(join(root, 'api'), (path) => path.endsWith('.js'))
    .map((path) => path.slice(root.length).split('\\').join('/'))
    .sort();
}

function rewriteSources() {
  return vercelConfig.rewrites.map((rewrite) => rewrite.source);
}

function sourceToRegExp(source) {
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/(^|\/):[A-Za-z0-9_]+/g, (match, slash) => `${slash}[^/]+`);
  return new RegExp(`^${pattern}$`);
}

test('the api directory stays within the 12 Serverless Function Hobby limit', () => {
  const files = functionFiles();
  assert.ok(files.length > 0, 'expected grouped function files');
  assert.ok(files.length <= 12, `expected 12 or fewer functions, found ${files.length}: ${files.join(', ')}`);
  // Dynamic segment filenames rely on Vercel route generation; the grouped API deliberately avoids them.
  for (const file of files) assert.ok(!file.includes('['), `${file} should not use a bracket dynamic segment`);
});

test('webhook and cron keep their exact external paths and safeguards', () => {
  const files = functionFiles();
  assert.ok(files.includes('api/webhooks/paystack.js'), 'the Paystack webhook path must not change');
  assert.ok(files.includes('api/cron/marketplace-maintenance.js'), 'the Vercel cron path must not change');

  assert.deepEqual(vercelConfig.crons, [{ path: '/api/cron/marketplace-maintenance', schedule: '0 0 * * *' }]);

  const webhook = readFileSync(join(root, 'api/webhooks/paystack.js'), 'utf8');
  assert.match(webhook, /bodyParser:\s*false/, 'the webhook must keep reading the raw body');
  assert.match(webhook, /createHmac\('sha512', secret\)/, 'the webhook must keep verifying the Paystack signature');
  assert.match(webhook, /x-paystack-signature/);

  const cron = readFileSync(join(root, 'api/cron/marketplace-maintenance.js'), 'utf8');
  assert.match(cron, /process\.env\.CRON_SECRET/);
  assert.match(cron, /transfersSent:0/);
  assert.match(cron, /expire_stale_bookings/);
  assert.match(cron, /release_mature_payouts/);
});

test('the static SPA rewrite for non-api paths is preserved', () => {
  const spa = vercelConfig.rewrites.filter((rewrite) => rewrite.destination === '/index.html');
  assert.equal(spa.length, 1);
  assert.equal(spa[0].source, '/((?!api/).*)');
});

test('every rewritten public url maps to an existing grouped route', () => {
  const sources = rewriteSources().filter((source) => source !== '/((?!api/).*)');
  // /api/listings is served directly by api/listings.js, so it needs no rewrite.
  const rewritten = PUBLIC_URLS.filter((url) => url !== '/api/listings');
  assert.deepEqual([...sources].sort(), [...rewritten].sort());
  assert.ok(functionFiles().includes('api/listings.js'), '/api/listings must resolve to api/listings.js');

  for (const rewrite of vercelConfig.rewrites) {
    if (rewrite.destination === '/index.html') continue;
    const [destinationPath, search = ''] = rewrite.destination.split('?');
    const table = FUNCTION_TABLES[`${destinationPath.replace(/^\//, '')}.js`];
    assert.ok(table, `no grouped function table for destination ${destinationPath}`);
    const routeKey = new URLSearchParams(search).get('route');
    assert.ok(routeKey, `rewrite ${rewrite.source} is missing a route key`);
    assert.ok(
      Object.prototype.hasOwnProperty.call(table.routes, routeKey),
      `route key ${routeKey} is missing from ${destinationPath}.js`,
    );
  }
});

test('each grouped route is reachable from a public url or is the function default', () => {
  const referenced = new Set(
    vercelConfig.rewrites
      .filter((rewrite) => rewrite.destination !== '/index.html')
      .map((rewrite) => rewrite.destination.split('?')[1])
      .flatMap((search) => (search ? [new URLSearchParams(search).get('route')] : [])),
  );

  for (const [file, table] of Object.entries(FUNCTION_TABLES)) {
    for (const key of Object.keys(table.routes)) {
      const reachable = referenced.has(key) || table.defaultRoute === key;
      assert.ok(reachable, `${file} route ${key} is not reachable from vercel.json`);
    }
  }
});

test('every /api/ url called from the frontend is covered by the grouped routes', () => {
  const sources = rewriteSources();
  const files = functionFiles().map((file) => `/${file.replace(/\.js$/, '')}`);
  const frontend = listFiles(join(root, 'src'), (path) => /\.(js|jsx)$/.test(path))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');

  const called = new Set();
  for (const match of frontend.matchAll(/\/api\/[A-Za-z0-9\-_/]*/g)) {
    const matched = match[0];
    const nextCharacter = frontend[match.index + matched.length];
    const trailingSlash = matched.endsWith('/');
    if (trailingSlash && nextCharacter === '$') {
      called.add(`${matched}:param`);
      continue;
    }
    called.add(matched.replace(/\/$/, ''));
  }

  assert.ok(called.size >= 20, `expected to find the frontend api calls, found ${called.size}`);
  for (const url of called) {
    const byRewrite = sources.some((source) => sourceToRegExp(source).test(url));
    const byFile = files.includes(url);
    assert.ok(byRewrite || byFile, `frontend call ${url} has no rewrite or function file`);
  }
});

test('grouped dispatchers route by key, enforce method checks, and 404 on unknown routes', async () => {
  for (const [file, table] of Object.entries(FUNCTION_TABLES)) {
    const { default: dispatch } = await import(`../${file}`);
    assert.equal(typeof dispatch, 'function', `${file} must default-export a dispatcher`);

    for (const key of Object.keys(table.routes)) {
      const response = createResponse();
      // PATCH is not allowed by any grouped route, so each handler must answer 405
      // before touching Supabase, which proves the key reached the right handler.
      await dispatch({ method: 'PATCH', query: { route: key }, headers: {} }, response);
      assert.equal(response.statusCode, 405, `${file} route ${key} did not dispatch to its handler`);
      assert.ok(response.allow, `${file} route ${key} did not set an Allow header`);
    }

    const unknown = createResponse();
    await dispatch({ method: 'PATCH', query: { route: 'not-a-real-route' }, headers: {} }, unknown);
    if (table.defaultRoute) {
      // The default route keeps bare function URLs working (e.g. /api/listings).
      assert.equal(unknown.statusCode, 405, `${file} must fall back to its default route`);
      assert.ok(Object.prototype.hasOwnProperty.call(table.routes, table.defaultRoute));
    } else {
      assert.equal(unknown.statusCode, 404, `${file} must reject unknown route keys`);
      assert.equal(unknown.payload?.error, 'This API endpoint was not found.');
    }
  }
});

test('listings keeps its default route for the bare /api/listings url', async () => {
  const { default: dispatch } = await import('../api/listings.js');
  const response = createResponse();
  await dispatch({ method: 'PATCH', query: {}, headers: {} }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.allow, 'GET');
});

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    get allow() { return this.headers.allow; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
}
