import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

const css = read('src/styles.css');
const app = read('src/App.jsx');

test('shared text-field input rule excludes checkboxes and radios with zero-specificity :where()', () => {
  // Using :where(:not([type='checkbox']):not([type='radio'])) prevents checkboxes from getting
  // width: 100% and min-height: 42px while keeping specificity at (0, 1, 1) so component rules
  // like .otp-control .otp-input and .availability-day input[type=time] still win.
  const sharedRuleMatch = css.match(
    /\.form-field input:where\(:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\)\)[\s\S]*?\{[^}]*width:\s*100%;[^}]*min-height:\s*42px;[^}]*\}/,
  );
  assert.ok(sharedRuleMatch, 'shared text-field rule must exclude checkbox and radio inputs via :where()');
  for (const formSelector of ['.form-field', '.contact-form', '.dispute-form', '.onboarding-form', '.otp-control']) {
    assert.ok(
      sharedRuleMatch[0].includes(`${formSelector} input:where(:not([type='checkbox']):not([type='radio']))`),
      `${formSelector} input must exclude checkbox and radio inputs without raising specificity`,
    );
  }
});

test('checkbox controls have explicit 16px dimensions and wrapping text spans', () => {
  assert.match(
    css,
    /\.check-line input\[type='checkbox'\],\s*\.remember-check input\[type='checkbox'\]\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;[^}]*min-width:\s*16px;[^}]*min-height:\s*16px;[^}]*flex:\s*0 0 16px;[^}]*accent-color:\s*var\(--orange\);[^}]*cursor:\s*pointer;/,
  );
  assert.match(css, /\.remember-check\s*\{[^}]*display:\s*flex;[^}]*gap:\s*8px;[^}]*line-height:\s*1\.5;/);
  assert.match(css, /\.remember-check span\s*\{\s*flex:\s*1;\s*min-width:\s*0;\s*\}/);
  assert.match(css, /\.terms-check\s*\{[^}]*align-items:\s*flex-start;[^}]*line-height:\s*1\.5;/);
  assert.match(css, /\.terms-check input\[type='checkbox'\]\s*\{\s*margin-top:\s*2px;\s*\}/);
});

test('component-specific OTP, time, and form-grid rules remain intact', () => {
  assert.match(
    css,
    /\.otp-control \.otp-input\s*\{[^}]*min-height:\s*54px;[^}]*text-align:\s*center;[^}]*font-size:\s*23px;/,
  );
  assert.match(
    css,
    /\.availability-day input\[type=time\]\s*\{[^}]*min-height:\s*34px;[^}]*height:\s*34px;/,
  );
  assert.match(
    css,
    /\.form-grid\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);\s*gap:\s*10px;\s*\}/,
  );
});

test('host onboarding, signup, contact, availability, and explore checkboxes wrap explanatory text and inline links in a single span', () => {
  // 1. Host onboarding Step 1 terms checkbox + View draft link
  assert.match(
    app,
    /<label className="remember-check terms-check"><input type="checkbox" checked=\{form\.termsAccepted\} onChange=\{\(event\)=>update\('termsAccepted',event\.target\.checked\)\}\/><span>I am submitting a host application and understand it is subject to review; host terms remain a draft until owner\/legal approval\. <Link to="\/terms">View draft<\/Link><\/span><\/label>/,
  );

  // 2. Signup terms and privacy checkbox + inline links
  assert.match(
    app,
    /<label className="remember-check"><input type="checkbox" checked=\{form\.accepted\} onChange=\{\(event\)=>setForm\(\{\.\.\.form,accepted:event\.target\.checked\}\)\}\/><span>I have read the draft <Link to="\/terms">terms<\/Link> and <Link to="\/privacy">privacy notice<\/Link>\.<\/span><\/label>/,
  );

  // 3. Contact form consent checkbox
  assert.match(
    app,
    /<label className="remember-check"><input type="checkbox" required checked=\{form\.consent\} onChange=\{\(event\)=>setForm\(\{\.\.\.form,consent:event\.target\.checked\}\)\}\/><span>I consent to this enquiry being stored for a response\.<\/span><\/label>/,
  );

  // 4. Host onboarding Step 4 availability weekday checkboxes
  assert.match(
    app,
    /<div className="availability-day" key=\{item\.weekday\}><label className="remember-check"><input type="checkbox" checked=\{current\.enabled\} onChange=\{\(event\)=>setAvailability\(\(rows\)=>rows\.map\(\(row\)=>row\.weekday===item\.weekday\?\{\.\.\.row,enabled:event\.target\.checked\}:row\)\)\}\/><span>\{item\.label\}<\/span><\/label>/,
  );

  // 5. Explore filter checkboxes
  assert.match(
    app,
    /<label className="check-line" key=\{item\}><input type="checkbox" checked=\{filters\.amenities\.includes\(item\)\} onChange=\{\(\)=>toggleAmenity\(item\)\}\/><span>\{item\}<\/span><\/label>/,
  );
  assert.match(
    app,
    /<label className="check-line filter-verified"><input type="checkbox" checked=\{verifiedOnly\} onChange=\{\(event\)=>setVerifiedOnly\(event\.target\.checked\)\}\/><span>Admin-reviewed only<\/span><BadgeCheck size=\{16\}\/><\/label>/,
  );
});
