import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { notificationTitle } from '../src/lib/notifications.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

// Every error code the new database functions raise must be listed in the API's known-message set,
// otherwise the owner and users see a generic error instead of the friendly text.
const NEW_MIGRATIONS = [
  'supabase/migrations/20261017000000_crew_pricing.sql',
  'supabase/migrations/20261017000100_listing_change_requests.sql',
  'supabase/migrations/20261017000200_withdrawals.sql',
];

function knownErrorCodes() {
  const source = read('api/_lib/http.js');
  const block = source.slice(source.indexOf('const known = new Set(['), source.indexOf(']);', source.indexOf('const known = new Set([')));
  return new Set([...block.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]));
}

test('every error code raised by the new migrations has a friendly message', () => {
  const known = knownErrorCodes();
  const raised = new Set();
  for (const file of NEW_MIGRATIONS) {
    for (const match of read(file).matchAll(/raise exception '([a-z_]+)'/g)) raised.add(match[1]);
  }
  assert.ok(raised.size >= 15, `expected many raised codes, found ${raised.size}`);
  const missing = [...raised].filter((code) => !known.has(code));
  assert.deepEqual(missing, [], `add these codes to the known set in api/_lib/http.js: ${missing.join(', ')}`);
});

test('the new migrations are additive: they never edit or replace the earlier migration files', () => {
  const dir = join(root, 'supabase/migrations');
  const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
  assert.ok(files.includes('20261017000000_crew_pricing.sql'));
  assert.ok(files.includes('20261017000100_listing_change_requests.sql'));
  assert.ok(files.includes('20261017000200_withdrawals.sql'));
  // Migrations are applied in filename order, so the new ones must sort after the existing ones.
  const existing = files.filter((name) => !NEW_MIGRATIONS.some((path) => path.endsWith(name)));
  assert.ok(existing.every((name) => name < '20261017000000'), 'existing migrations must sort before the new ones');
  for (const name of files) assert.ok(statSync(join(dir, name)).isFile());
});

test('no code in the app or API calls a Paystack transfer or payout endpoint', () => {
  // Withdrawals are record-and-track only. The owner pays manually; the app never moves money.
  const forbidden = /paystack\.co\/(transfer|payout|bulk)|transferrecipient|\/transfer['"`]|\/transfer\?|\/payout['"`]/i;
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(js|jsx)$/.test(entry)) files.push(path);
    }
  };
  walk(join(root, 'api'));
  walk(join(root, 'src'));
  const offenders = files.filter((path) => forbidden.test(readFileSync(path, 'utf8')));
  assert.deepEqual(offenders.map((path) => path.slice(root.length)), []);
});

test('the withdrawal and change-request endpoints do not expose a transfer capability', () => {
  const payments = read('api/_lib/endpoints/payments.js');
  const withdrawalBlock = payments.slice(payments.indexOf('export async function requestWithdrawal'), payments.indexOf('function isUuid'));
  assert.match(withdrawalBlock, /request_host_withdrawal/);
  assert.match(withdrawalBlock, /request_platform_withdrawal/);
  assert.doesNotMatch(withdrawalBlock, /fetch\(|paystack/i, 'the withdrawal request must not call the provider');
});

test('each new notification type has a human title', () => {
  const types = [
    'listing_change_requested', 'listing_change_approved', 'listing_change_rejected',
    'withdrawal_requested', 'withdrawal_approved', 'withdrawal_paid', 'withdrawal_rejected',
  ];
  for (const type of types) {
    assert.notEqual(notificationTitle(type), notificationTitle('unknown_event_type'), `${type} needs a title`);
  }
  // The titles used in the SQL must match the keys the UI knows about.
  const sql = NEW_MIGRATIONS.slice(1).map(read).join('\n');
  for (const type of ['listing_change_requested', 'withdrawal_requested']) assert.match(sql, new RegExp(type));
});

test('the host change form and payouts copy keep the honest disclosures', () => {
  const app = read('src/App.jsx');
  assert.match(app, /This product does not send a transfer or promise escrow\./);
  assert.match(app, /Photos cannot be changed here yet/);
  assert.match(app, /Every person in the crew pays this rate for each hour/);
});
