#!/usr/bin/env node
// Robust repo-count badge generator:
// - Queries both user(login:) and organization(login:) so it works for user or org owners.
// - Does not hard-fail the workflow on missing token or API errors; writes a fallback SVG instead.
// - Counts all repositories (privacy: ALL). To include private repos for orgs or users, set secret GH_PAT.

const fs = require('fs');
const https = require('https');

const token = process.env.GH_API_TOKEN || process.env.GITHUB_TOKEN;
const username = process.env.GH_USERNAME || process.env.GITHUB_REPOSITORY_OWNER || '';

function writeFallbackSVG(message) {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="360" height="88" viewBox="0 0 360 88" role="img" aria-labelledby="title desc">
  <title id="title">Repo count unavailable</title>
  <desc id="desc">${message}</desc>
  <rect rx="14" ry="14" width="360" height="88" fill="#111827"/>
  <text x="24" y="46" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial" font-size="14" fill="#fff">Repositories: unavailable — ${escapeXml(message)}</text>
</svg>`;
  if (!fs.existsSync('assets')) fs.mkdirSync('assets', { recursive: true });
  fs.writeFileSync('assets/repo-count.svg', svg, 'utf8');
  console.log('Wrote fallback assets/repo-count.svg');
}

function escapeXml(unsafe) {
  return String(unsafe).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  }[c]));
}

if (!username) {
  console.error('Missing GH_USERNAME or repository owner. Writing fallback badge.');
  writeFallbackSVG('missing owner');
  process.exit(0); // graceful exit to avoid failing the workflow
}

if (!token) {
  console.warn('No API token found (GH_API_TOKEN or GITHUB_TOKEN). Writing fallback badge. Set GH_PAT secret to include private repos.');
  writeFallbackSVG('no token');
  process.exit(0);
}

const query = JSON.stringify({
  query: `query ($login: String!) {
    user(login: $login) {
      repositories(privacy: ALL) {
        totalCount
      }
    }
    organization(login: $login) {
      repositories(privacy: ALL) {
        totalCount
      }
    }
  }`,
  variables: { login: username },
});

const options = {
  hostname: 'api.github.com',
  path: '/graphql',
  method: 'POST',
  headers: {
    'User-Agent': `${username}-repo-count-badge`,
    Authorization: `bearer ${token}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(query, 'utf8'),
  },
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => (body += chunk));
  res.on('end', () => {
    try {
      const json = JSON.parse(body);
      if (json.errors && json.errors.length) {
        console.error('GraphQL returned errors:', JSON.stringify(json.errors, null, 2));
        writeFallbackSVG('api error');
        return process.exit(0);
      }

      const user = json.data && json.data.user;
      const org = json.data && json.data.organization;
      let total = null;
      if (user && user.repositories && typeof user.repositories.totalCount === 'number') {
        total = user.repositories.totalCount;
      } else if (org && org.repositories && typeof org.repositories.totalCount === 'number') {
        total = org.repositories.totalCount;
      }

      if (total === null) {
        console.error('Could not determine repository count from response. Writing fallback badge.');
        console.error('Response:', JSON.stringify(json, null, 2));
        writeFallbackSVG('no data');
        return process.exit(0);
      }

      const svg = makeBadgeSVG(username, total);
      const outPath = 'assets/repo-count.svg';
      if (!fs.existsSync('assets')) fs.mkdirSync('assets', { recursive: true });
      fs.writeFileSync(outPath, svg, 'utf8');
      console.log('Wrote', outPath);
    } catch (err) {
      console.error('Failed to parse response or other error:', err);
      writeFallbackSVG('parse error');
      return process.exit(0);
    }
  });
});

req.on('error', (err) => {
  console.error('Request error', err);
  writeFallbackSVG('request error');
  process.exit(0);
});

req.write(query);
req.end();

function makeBadgeSVG(user, count) {
  const label = 'Repositories';
  const display = String(count);
  const width = 360;
  const height = 88;
  const leftColor = '#0ea5a4'; // teal
  const rightColor = '#0b1220'; // dark
  const accent = '#06b6d4';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(user)} - ${label} badge</title>
  <desc id="desc">Shows the total repository count for ${escapeXml(user)} on GitHub</desc>
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

  <!-- Left: icon + username -->
  <g transform="translate(22,22)" fill="#fff" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial">
    <g transform="translate(0,0) scale(1)" fill="#fff" aria-hidden="true">
      <path d="M10 0C4.477 0 0 4.477 0 10c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.483 0-.238-.009-.868-.014-1.703-2.782.603-3.369-1.342-3.369-1.342-.455-1.156-1.11-1.464-1.11-1.464-.907-.62.069-.607.069-.607 1.003.071 1.532 1.031 1.532 1.031.892 1.528 2.341 1.087 2.91.832.091-.647.349-1.087.634-1.337-2.22-.252-4.556-1.112-4.556-4.948 0-1.093.39-1.987 1.03-2.686-.103-.253-.447-1.27.098-2.647 0 0 .84-.269 2.75 1.026A9.564 9.564 0 0110 5.8c.85.004 1.705.115 2.504.338 1.909-1.295 2.748-1.026 2.748-1.026.546 1.378.202 2.394.1 2.647.64.699 1.03 1.593 1.03 2.686 0 3.846-2.339 4.693-4.567 4.94.359.309.679.92.679 1.854 0 1.337-.012 2.416-.012 2.745 0 .268.18.579.688.481A10.013 10.013 0 0020 10C20 4.477 15.523 0 10 0z"/>
    </g>

    <text x="72" y="30" font-size="22" font-weight="700" fill="#fff">${escapeXml(user)}</text>
    <text x="72" y="52" font-size="12" fill="#e6f6f6" opacity="0.95">${label}</text>
  </g>

  <!-- Right: repo count -->
  <g transform="translate(${width - 170}, 22)">
    <rect rx="12" ry="12" width="140" height="44" fill="#010617" opacity="0.06"></rect>
    <text x="70" y="30" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial" font-size="30" font-weight="900" fill="${accent}" text-anchor="middle">${display}</text>
    <text x="70" y="46" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial" font-size="10" fill="#cfeefc" text-anchor="middle" opacity="0.9">Total repos (all languages & forks)</text>
  </g>
</svg>`;
}
