#!/usr/bin/env node
/**
 * Generate Apple Sign In client secret JWT.
 * Usage: node scripts/generate-apple-secret.mjs /path/to/AuthKey.p8
 *
 * The JWT is valid for 180 days (Apple max is 6 months).
 * Rotate by re-running and updating Doppler.
 */

import { readFileSync } from 'fs';
import { createPrivateKey, createSign } from 'crypto';

const TEAM_ID = '2HVQQ4W769';
const KEY_ID = 'PNZ623ZN92';
const CLIENT_ID = 'fm.sotto.web';
const EXPIRY_DAYS = 180;

const keyPath = process.argv[2];
if (!keyPath) {
  console.error('Usage: node scripts/generate-apple-secret.mjs /path/to/AuthKey.p8');
  process.exit(1);
}

const privateKeyPem = readFileSync(keyPath, 'utf8');
const privateKey = createPrivateKey(privateKeyPem);

const now = Math.floor(Date.now() / 1000);
const exp = now + EXPIRY_DAYS * 24 * 60 * 60;

const header = { alg: 'ES256', kid: KEY_ID };
const payload = {
  iss: TEAM_ID,
  iat: now,
  exp,
  aud: 'https://appleid.apple.com',
  sub: CLIENT_ID,
};

function base64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

const signingInput = `${base64url(header)}.${base64url(payload)}`;
const sign = createSign('SHA256');
sign.update(signingInput);
const signature = sign
  .sign({ key: privateKey, dsaEncoding: 'ieee-p1363' })
  .toString('base64')
  .replace(/=/g, '')
  .replace(/\+/g, '-')
  .replace(/\//g, '_');

const jwt = `${signingInput}.${signature}`;

console.log('\n--- Apple Client Secret (valid %d days, expires %s) ---\n', EXPIRY_DAYS, new Date(exp * 1000).toISOString().split('T')[0]);
console.log(jwt);
console.log('\nSet in Doppler:');
console.log('  APPLE_CLIENT_ID = fm.sotto.web');
console.log('  APPLE_CLIENT_SECRET = <the JWT above>\n');
