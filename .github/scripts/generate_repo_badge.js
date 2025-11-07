#!/usr/bin/env node
// Robust repo-count badge generator:
// - Uses GraphQL if a token exists (accurate count, includes private when token has scopes).
// - If no token, tries REST fallback to get public repo count (so you won't see "unavailable").
// - Never fails the workflow on missing token / API error; instead writes a readable badge/fallback.
// - Accepts token via GH_API_TOKEN (workflow sets this from secrets.MY_TOKEN || secrets.GH_PAT || github.token).

const fs = require('fs');
const https = require('https');

const token = process.env.GH_API_TOKEN || process.env.GITHUB_TOKEN || '';
const username = process.env.GH_USERNAME || process.env.GITHUB_REPOSITORY_OWNER || '';

function escapeXml(unsafe) {
  return String(unsafe).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  }[c]));
}

function writeSVG(svg) {
  if (!fs.existsSync('assets')) fs.mkdirSync('assets', { recursive: true });
  fs.writeFileSync('assets/repo-count.svg', svg, 'utf8');
  console.log('Wrote assets/repo-count.svg');
}

function makeNiceFallback(message) {
  // Better-looking fallback SVG for when we don't have a count
  const w = 360, h = 72;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title desc">
  <title id="title">Repositories</title>
  <desc id="desc">${escapeXml(message)}</desc>
  <defs>
    <linearGradient id="g" x1="0" x2="1"><stop offset="0%" stop-color="#0ea5a4"/><stop offset="100%" stop-color="#0b1220"/></linearGradient>
  </defs>
  <rect rx="12" width="${w}" height="${h}" fill="url(#g)"/>
  <g font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial" fill="#fff">
    <text x="20" y="36" font-size="16" font-weight="700">Repositories</text>
    <text x="20" y="54" font-size="12" opacity="0.9">Unavailable — ${escapeXml(message)}</text>
  </g>
</svg>`;
}

function makeBadgeSVG(user, count, note = 'Total repos (all)') {
  const label = 'Repositories';
  const display = String(count);
  const width = 360;
  const height = 88;
  const leftColor = '#0ea5a4';
  const rightColor = '#0b1220';
  const accent = '#06b6d4';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(user)} - ${label} badge</title>
  <desc id="desc">Shows the repository count for ${escapeXml(user)}</desc>
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stop-color="${leftColor}" stop-opacity="0.98"/>
      <stop offset="100%" stop-color="${rightColor}" stop-opacity="0.98"/>
    </linearGradient>
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000" flood-opacity="0.12"/>
    </filter>
  </defs>

  <rect rx="14" ry="14" width="${width}" height="${height}" fill="url(#g)" filter="url(#shadow)"/>

  <g transform="translate(20,20)" fill="#fff" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial">
    <!-- Simple octocat glyph -->
    <g transform="translate(0,0) scale(1)" fill="#fff" aria-hidden="true">
      <path d="M10 0C4.48 0 0 4.48 0 10c0 4.42 2.87 8.16 6.84 9.49.5.09.68-.22.68-.48 0-.24-.01-.87-.01-1.7-2.78.6-3.37-1.34-3.37-1.34-.46-1.15-1.11-1.46-1.11-1.46-.91-.62.07-.61.07-.61 1 .07 1.54 1.03 1.54 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03A9.57 9.57 0 0110 5.8c.85.00 1.71.12 2.5.34 1.91-1.29 2.75-1.03 2.75-1.03.55 1.38.2 2.39.1 2.65.64.7 1.03 1.59 1.03 2.69 0 3.85-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85 0 1.34-.01 2.42-.01 2.74 0 .27.18.58.69.48A10.01 10.01 0 0020 10C20 4.48 15.52 0 10 0z"/>
    </g>

    <text x="62" y="28" font-size="20" font-weight="700">${escapeXml(user)}</text>
    <text x="62" y="46" font-size="12" opacity="0.9">${label}</text>
  </g>

  <g transform="translate(${width - 180}, 22)">
    <rect rx="12" ry="12" width="150" height="44" fill="#010617" opacity="0.06"></rect>
    <text x="75" y="30" font-size="30" font-weight="900" fill="${accent}" text-anchor="middle">${display}</text>
    <text x="75" y="46" font-size="10" fill="#cfeefc" text-anchor="middle" opacity="0.9">${escapeXml(note)}</text>
  </g>
</svg>`;
}

// Helpers for HTTPS calls
function httpsRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  if (!username) {
    console.warn('Missing owner; writing fallback badge.');
    writeSVG(makeNiceFallback('missing owner'));
    return;
  }

  // 1) If we have a token, prefer GraphQL (accurate total, includes private repos if token scopes allow)
  if (token) {
    try {
      const gql = JSON.stringify({
        query: `query ($login: String!) {
          user(login: $login) { repositories(privacy: ALL) { totalCount } }
          organization(login: $login) { repositories(privacy: ALL) { totalCount } }
        }`,
        variables: { login: username },
      });

      const opts = {
        hostname: 'api.github.com',
        path: '/graphql',
        method: 'POST',
        headers: {
          'User-Agent': `${username}-repo-count-badge`,
          Authorization: `bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(gql, 'utf8'),
        },
      };

      const res = await httpsRequest(opts, gql);
      const json = JSON.parse(res.body || '{}');

      if (json.errors && json.errors.length) {
        console.warn('GraphQL returned errors, falling back to REST for public count.');
      } else {
        const user = json.data && json.data.user;
        const org = json.data && json.data.organization;
        let total = null;
        if (user && user.repositories && typeof user.repositories.totalCount === 'number') {
          total = user.repositories.totalCount;
        } else if (org && org.repositories && typeof org.repositories.totalCount === 'number') {
          total = org.repositories.totalCount;
        }

        if (total !== null) {
          writeSVG(makeBadgeSVG(username, total, 'Total repos (all)'));
          return;
        }
      }
    } catch (err) {
      console.warn('GraphQL request failed:', err.message || err);
      // continue to REST fallback
    }
  }

  // 2) No token or GraphQL failed: try REST to get public repo count (works without token)
  try {
    // prefer /users/:username
    const headers = { 'User-Agent': `${username}-repo-count-badge` };
    if (token) headers['Authorization'] = `bearer ${token}`;

    const userOpts = { hostname: 'api.github.com', path: `/users/${encodeURIComponent(username)}`, method: 'GET', headers };
    let r = await httpsRequest(userOpts);
    if (r.status === 200) {
      const body = JSON.parse(r.body || '{}');
      if (typeof body.public_repos === 'number') {
        writeSVG(makeBadgeSVG(username, body.public_repos, 'Public repos'));
        return;
      }
    }

    // if /users failed, try /orgs/:org
    const orgOpts = { hostname: 'api.github.com', path: `/orgs/${encodeURIComponent(username)}`, method: 'GET', headers };
    r = await httpsRequest(orgOpts);
    if (r.status === 200) {
      const body = JSON.parse(r.body || '{}');
      // org object also contains public_repos
      if (typeof body.public_repos === 'number') {
        writeSVG(makeBadgeSVG(username, body.public_repos, 'Public repos (org)'));
        return;
      }
    }

    // nothing worked
    console.warn('REST fallback did not return a public repo count.');
    writeSVG(makeNiceFallback('no token / no public count'));
    return;
  } catch (err) {
    console.warn('REST request failed:', err.message || err);
    writeSVG(makeNiceFallback('request error'));
    return;
  }
})();
