// Page-view / song-play relay for kaig78.github.io -> GoatCounter API.
// Ad blockers block goatcounter.com directly; this neutral endpoint forwards
// the hit server-side with the visitor's IP + user agent, so GoatCounter can
// still derive country and unique visitors (GoatCounter does not store IPs).
// Env var needed: GC_TOKEN (GoatCounter API key with "Record pageviews" permission).

const ALLOWED = /^https:\/\/kaig78\.github\.io\//;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const q = req.query || {};
  const origin = String(req.headers.referer || req.headers.origin || '');
  const token = process.env.GC_TOKEN;
  const path = String(q.p || '').slice(0, 500);
  if (!token) { res.setHeader('X-Relay', 'no-token'); return res.status(204).end(); }
  if (!path || !ALLOWED.test(origin)) { res.setHeader('X-Relay', 'skipped'); return res.status(204).end(); }

  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const hit = {
    path,
    title: String(q.t || '').slice(0, 300),
    event: q.e === '1' || q.e === 'true',
    ref: String(q.r || '').slice(0, 500),
    size: String(q.s || ''),
    ip,
    user_agent: String(req.headers['user-agent'] || ''),
  };
  try {
    const r = await fetch('https://kaig78.goatcounter.com/api/v0/count', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ no_sessions: false, hits: [hit] }),
    });
    res.setHeader('X-Relay', 'gc-' + r.status + (r.ok ? '' : ' ' + (await r.text()).slice(0, 150).replace(/[^\x20-\x7e]/g, ' ')));
  } catch (e) { res.setHeader('X-Relay', 'error'); }
  res.status(204).end();
};
