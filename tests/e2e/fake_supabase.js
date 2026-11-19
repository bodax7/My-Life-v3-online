// Minimal in-memory stand-in for the Supabase endpoints MyLife uses (auth, rpc, records w/ readers rule, members, storage).
// Used ONLY to test the client sync logic offline. The real RLS is tested against Postgres (supabase/schema.sql).
const http = require('http'); const crypto = require('crypto');
const users = {}, tokens = {}, refresh = {}, hh = {}, members = [], records = new Map(), objects = new Map();
let tick = 0; const stamp = () => new Date(Date.UTC(2026, 10, 19, 10, 0, 0) + (++tick) * 1000).toISOString();
const send = (res, code, body, extra = {}) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', ...extra }); res.end(body === undefined ? '' : (Buffer.isBuffer(body) ? body : JSON.stringify(body))); };
const session = u => { const a = 'at_' + crypto.randomUUID(), r = 'rt_' + crypto.randomUUID(); tokens[a] = u.id; refresh[r] = u.id; return { access_token: a, refresh_token: r, expires_in: 3600, user: { id: u.id, email: u.email } }; };
const myM = uid => members.find(m => m.user_id === uid);
http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const chunks = []; for await (const c of req) chunks.push(c); const raw = Buffer.concat(chunks); const url = new URL(req.url, 'http://x'); const p = url.pathname;
  const uid = tokens[(req.headers.authorization || '').replace('Bearer ', '')]; const json = () => { try { return JSON.parse(raw.toString()); } catch (e) { return {}; } };
  console.log(req.method, p, uid ? uid.slice(0, 4) : '-');
  if (p === '/auth/v1/signup') { const b = json(); if (Object.values(users).find(u => u.email === b.email)) return send(res, 422, { error_code: 'user_already_exists', msg: 'User already registered' }); const u = { id: crypto.randomUUID(), email: b.email, password: b.password }; users[u.id] = u; return send(res, 200, session(u)); }
  if (p === '/auth/v1/token') { const b = json(); if (url.searchParams.get('grant_type') === 'password') { const u = Object.values(users).find(u => u.email === b.email && u.password === b.password); if (!u) return send(res, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' }); return send(res, 200, session(u)); } const id = refresh[b.refresh_token]; if (!id) return send(res, 400, { error_code: 'refresh_token_not_found' }); return send(res, 200, session(users[id])); }
  if (!uid) return send(res, 401, { message: 'JWT required' });
  if (p === '/rest/v1/rpc/create_household') { const b = json(); if (myM(uid)) return send(res, 400, { code: 'P0001', message: 'ALREADY_IN_HOUSEHOLD' }); const id = crypto.randomUUID(); hh[id] = { id, name: b.p_name, code: crypto.randomBytes(4).toString('hex').toUpperCase() }; members.push({ household_id: id, user_id: uid, role: 'admin', name: b.p_display, email: users[uid].email }); return send(res, 200, { household_id: id }); }
  if (p === '/rest/v1/rpc/join_household') { const b = json(); const h = Object.values(hh).find(h => h.code === String(b.p_code).toUpperCase().trim()); if (!h) return send(res, 400, { code: 'P0001', message: 'BAD_CODE' }); if (myM(uid)) return send(res, 400, { code: 'P0001', message: 'ALREADY_IN_HOUSEHOLD' }); members.push({ household_id: h.id, user_id: uid, role: 'member', name: b.p_display, email: users[uid].email }); return send(res, 200, { household_id: h.id }); }
  if (p === '/rest/v1/rpc/my_household') { const m = myM(uid); if (!m) return send(res, 200, null); const h = hh[m.household_id]; return send(res, 200, { household_id: h.id, role: m.role, name: h.name, code: m.role === 'admin' ? h.code : null, members: members.filter(x => x.household_id === h.id).map(({ user_id, role, name, email }) => ({ user_id, role, name, email })) }); }
  const m = myM(uid); if (!m) return send(res, 403, { message: 'not a member' });
  const key = (h, s, i) => h + '|' + s + '|' + i;
  if (p === '/rest/v1/records') {
    if (req.method === 'GET') { const since = url.searchParams.get('updated_at'); const lim = +url.searchParams.get('limit') || 1000; let rows = [...records.values()].filter(r => r.household_id === m.household_id && (r.all_members || r.readers.includes(uid))); if (since) rows = rows.filter(r => r.updated_at > new Date(since.replace(/^gt\./, '')).toISOString()); rows.sort((a, b) => a.updated_at < b.updated_at ? -1 : 1); return send(res, 200, rows.slice(0, lim)); }
    if (req.method === 'POST') { const rows = json(); for (const r of rows) { if (r.household_id !== m.household_id || !(r.all_members || r.readers.includes(uid))) return send(res, 403, { code: '42501', message: 'new row violates row-level security policy for table "records"' }); const old = records.get(key(r.household_id, r.store, r.id)); if (old && !(old.all_members || old.readers.includes(uid))) return send(res, 403, { code: '42501', message: 'new row violates row-level security policy (USING expression)' }); }
      for (const r of rows) records.set(key(r.household_id, r.store, r.id), { ...r, updated_at: stamp(), updated_by: uid }); return send(res, 201); }
    if (req.method === 'PATCH') { const q = k => (url.searchParams.get(k) || '').replace(/^eq\./, ''); const r = records.get(key(q('household_id'), q('store'), q('id'))); if (r && (r.all_members || r.readers.includes(uid))) { Object.assign(r, json(), { updated_at: stamp() }); } return send(res, 204); }
  }
  if (p === '/rest/v1/members') return send(res, 200, members.filter(x => x.household_id === m.household_id));
  const so = p.match(/^\/storage\/v1\/object\/(?:authenticated\/)?files\/([^/]+)\/(.+)$/);
  if (so) { const [, h, id] = so; if (h !== m.household_id) return send(res, 403, { message: 'denied' });
    if (req.method === 'POST') { objects.set(id, { buf: raw, type: req.headers['content-type'] }); return send(res, 200, { Key: 'files/' + h + '/' + id }); }
    if (req.method === 'GET') { const rec = records.get(key(h, 'files', id)); const o = objects.get(id); if (!rec || !(rec.all_members || rec.readers.includes(uid)) || !o) return send(res, 404, { message: 'not found' }); res.writeHead(200, { 'content-type': o.type, 'access-control-allow-origin': '*' }); return res.end(o.buf); }
    if (req.method === 'DELETE') { objects.delete(id); return send(res, 200, {}); } }
  send(res, 404, { message: 'no route ' + p });
}).listen(8766, () => console.log('fake supabase on 8766'));
process.on('SIGTERM', () => process.exit(0));
