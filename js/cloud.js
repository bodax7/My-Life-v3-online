/* MyLife — optional cloud sync (Supabase). Local-first: the app always works from IndexedDB;
   this module pushes local changes and pulls others' changes. No SDK; plain fetch. */
const Cloud = (() => {
  const DEFAULT_URL = 'https://iuflfyyeqyybjjadgvpj.supabase.co';
  const DEFAULT_KEY = 'sb_publishable_F2glyBlKOJlg4igBkNiW6A_dkyUIGcs';   // public (publishable) key — safe to ship in the app
  const SYNC = ['accounts', 'transactions', 'categories', 'budgets', 'recurring', 'goals', 'contribs', 'debts', 'debtPays', 'closings', 'recons', 'audit', 'rates', 'notes', 'tasks', 'shopLists', 'shopItems', 'events', 'files'];
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('mylife.cloud.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('mylife.cloud.' + k, JSON.stringify(v)); } catch (e) { } },
    del(k) { try { localStorage.removeItem('mylife.cloud.' + k); } catch (e) { } },
  };
  const URL_ = () => LS.get('urlOverride', DEFAULT_URL), KEY = () => LS.get('keyOverride', DEFAULT_KEY);   // overrides are for testing only
  let S = null, session = LS.get('session', null), meta = LS.get('meta', null);
  let outbox = new Set(LS.get('outbox', [])), blobq = new Set(LS.get('blobq', []));
  const skip = new Set(); const listeners = [];
  const st = { state: 'idle', last: LS.get('last', null), error: null, errors: LS.get('errors', 0) };
  const emit = () => listeners.forEach(f => { try { f(); } catch (e) { } });
  const saveOutbox = () => { LS.set('outbox', [...outbox]); LS.set('blobq', [...blobq]); };
  const cerr = (code, message, status) => { const e = new Error(message || code); e.code = code; e.status = status; return e; };

  /* ---------- HTTP ---------- */
  async function http(path, o = {}) {
    const hd = { apikey: KEY(), ...(o.headers || {}) }; let body = o.body;
    if (o.auth !== false) { const tk = await token(); hd.Authorization = 'Bearer ' + tk; }
    if (body !== undefined && !(body instanceof Blob)) { hd['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), o.timeout || 30000); let r;
    try { r = await fetch(URL_() + path, { method: o.method || 'GET', headers: hd, body, signal: ctl.signal, cache: 'no-store' }); }
    catch (e) { throw cerr('NETWORK', e.message); } finally { clearTimeout(tm); }
    if (o.blob && r.ok) return r.blob();
    const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { }
    if (!r.ok) {
      const msg = (j && (j.message || j.msg || j.error_description || j.error)) || txt || ('HTTP ' + r.status);
      let code = (j && (j.error_code || (typeof j.code === 'string' && !/^\d/.test(j.code) && !/^PGRST|^P0/.test(j.code) ? j.code : null))) || (/^[A-Z_]{3,}$/.test(String(msg)) ? msg : null) || 'HTTP_' + r.status;
      throw cerr(code, msg, r.status);
    }
    return j;
  }
  function setSession(j) {
    session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: { id: j.user.id, email: j.user.email } };
    LS.set('session', session);
  }
  async function token() {
    if (!session) throw cerr('NOT_SIGNED_IN');
    if (session.expires_at - Math.floor(Date.now() / 1000) > 60) return session.access_token;
    try { const j = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token }, auth: false }); setSession(j); }
    catch (e) { if (e.code !== 'NETWORK' && e.status >= 400 && e.status < 500) { session = null; LS.del('session'); st.state = 'login'; emit(); throw cerr('NOT_SIGNED_IN'); } throw e; }
    return session.access_token;
  }
  async function signUp(email, password, name) {
    const j = await http('/auth/v1/signup', { method: 'POST', body: { email, password, data: { name } }, auth: false });
    if (j && j.access_token) setSession(j); else throw cerr('CONFIRM_EMAIL');
  }
  async function signIn(email, password) { setSession(await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false })); }

  /* ---------- household ---------- */
  const myHousehold = () => http('/rest/v1/rpc/my_household', { method: 'POST', body: {} });
  const createHousehold = (name, display) => http('/rest/v1/rpc/create_household', { method: 'POST', body: { p_name: name, p_display: display } });
  const joinHousehold = (code, display) => http('/rest/v1/rpc/join_household', { method: 'POST', body: { p_code: code, p_display: display } });
  function adoptHousehold(hh) {
    const epoch = (meta && meta.epoch) || Fin.uid();
    meta = { ...(meta || {}), householdId: hh.household_id, role: hh.role, name: hh.name || '', code: hh.code || null, members: hh.members || [], userId: session.user.id, email: session.user.email, epoch, cursor: (meta && meta.householdId === hh.household_id) ? meta.cursor : null };
    LS.set('meta', meta); return meta;
  }
  const linked = () => !!(meta && meta.householdId && session);
  const memberIds = () => new Set(((meta && meta.members) || []).map(m => m.user_id));
  const people = () => { const ids = memberIds(); return S.users.filter(u => ids.has(u.id)); };

  /* ---------- local identity: make the local profile's id equal the cloud user id ---------- */
  function remapUserId(oldId, newId) {
    if (!oldId || oldId === newId) return;
    for (const store of Fin.STORES.concat(['users'])) {
      S[store] = S[store].map(r => {
        const s = JSON.stringify(r); if (!s.includes(oldId)) return r;
        const n = JSON.parse(s.split(oldId).join(newId)); S.dirty.push([store, n.id]); if (store === 'users' && r.id === oldId) S.removed.push(['users', oldId]); return n;
      });
    }
    for (const k of Object.keys(S.settings)) if (k.includes(oldId)) { const nk = k.split(oldId).join(newId); S.settings[nk] = S.settings[k]; delete S.settings[k]; S.dirty.push(['settings', nk]); S.removed.push(['settings', k]); }
    try { if (sessionStorage.getItem('mylife.user') === oldId) sessionStorage.setItem('mylife.user', newId); } catch (e) { }
  }
  function markAllPending() { for (const store of SYNC) for (const r of S[store]) outbox.add(store + '|' + r.id); saveOutbox(); }

  /* ---------- who may read each record (enforced by the server's RLS) ---------- */
  function readersOf(store, rec, me) {
    const U = people(), all = U.map(u => u.id), ids = us => us.map(u => u.id);
    const acc = id => { const a = id && Fin.get(S, 'accounts', id); return a ? ids(U.filter(u => Fin.canView(a, u))) : []; };
    let r;
    switch (store) {
      case 'accounts': r = ids(U.filter(u => Fin.canView(rec, u))); break;
      case 'transactions': r = [...acc(rec.accountId), ...(rec.toAccountId ? acc(rec.toAccountId) : [])]; break;
      case 'notes': r = ids(U.filter(u => Life.canViewNote(rec, u))); break;
      case 'tasks': r = ids(U.filter(u => Life.canViewTask(rec, u))); break;
      case 'events': r = ids(U.filter(u => Life.canViewEvent(rec, u))); break;
      case 'shopLists': r = ids(U.filter(u => Life.canViewList(rec, u))); break;
      case 'shopItems': { const l = Fin.get(S, 'shopLists', rec.listId); r = l ? ids(U.filter(u => Life.canViewList(l, u))) : []; break; }
      case 'files': r = ids(U.filter(u => Life.canViewFile(S, rec, u))); break;
      case 'categories': case 'rates': r = all; break;
      case 'audit': r = [rec.by]; break;
      case 'contribs': { const g = Fin.get(S, 'goals', rec.goalId); r = g ? readersOf('goals', g, me) : []; break; }
      case 'debtPays': { const d = Fin.get(S, 'debts', rec.debtId); r = d ? readersOf('debts', d, me) : []; break; }
      default:
        if (rec.accountId) r = acc(rec.accountId);
        else if (rec.scope) r = rec.scope === 'household' ? all : [rec.ownerId || rec.createdBy || me];
        else r = rec.ownerId ? [rec.ownerId] : all;
    }
    r = [...new Set((r || []).filter(Boolean))]; if (!r.includes(me)) r.push(me); return r;
  }

  const ghost = { id: '__all__', role: 'member', name: '' };   // a made-up member: can it see the record? then the record is household-wide
  function sharedWithAll(store, rec) {
    const acc = id => { const a = id && Fin.get(S, 'accounts', id); return !!a && Fin.canView(a, ghost); };
    switch (store) {
      case 'accounts': return Fin.canView(rec, ghost);
      case 'transactions': return acc(rec.accountId) && (!rec.toAccountId || acc(rec.toAccountId));
      case 'notes': return Life.canViewNote(rec, ghost); case 'tasks': return Life.canViewTask(rec, ghost); case 'events': return Life.canViewEvent(rec, ghost); case 'shopLists': return Life.canViewList(rec, ghost);
      case 'shopItems': { const l = Fin.get(S, 'shopLists', rec.listId); return !!l && Life.canViewList(l, ghost); }
      case 'files': return Life.canViewFile(S, rec, ghost);
      case 'categories': case 'rates': return true; case 'audit': return false;
      case 'contribs': { const g = Fin.get(S, 'goals', rec.goalId); return !!g && sharedWithAll('goals', g); }
      case 'debtPays': { const d = Fin.get(S, 'debts', rec.debtId); return !!d && sharedWithAll('debts', d); }
      default: if (rec.accountId) return acc(rec.accountId); if (rec.scope) return rec.scope === 'household'; return !rec.ownerId;
    }
  }

  /* ---------- push ---------- */
  const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
  const UP = '/rest/v1/records?on_conflict=household_id,store,id';
  const upsert = rows => http(UP, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: rows });
  const isFatal = e => e.code === 'NETWORK' || e.code === 'NOT_SIGNED_IN' || (e.status >= 500) || e.status === 401 || e.status === 429;
  async function push() {
    if (!outbox.size) { await pushBlobs(); return; }
    const me = session.user.id, hid = meta.householdId; const live = [], dead = [];
    for (const k of [...outbox]) {
      const i = k.indexOf('|'), store = k.slice(0, i), id = k.slice(i + 1), rec = Fin.get(S, store, id);
      if (rec) live.push({ k, store, id, row: { household_id: hid, store, id, data: rec, readers: readersOf(store, rec, me), all_members: !!sharedWithAll(store, rec), deleted: false } });
      else dead.push({ k, store, id });
    }
    for (const part of chunk(live, 100)) {
      try { await upsert(part.map(x => x.row)); part.forEach(x => { outbox.delete(x.k); if (x.store === 'files') blobq.add(x.id); }); }
      catch (e) {
        if (isFatal(e)) { saveOutbox(); throw e; }
        for (const x of part) { try { await upsert([x.row]); outbox.delete(x.k); if (x.store === 'files') blobq.add(x.id); } catch (e2) { if (isFatal(e2)) { saveOutbox(); throw e2; } outbox.delete(x.k); st.errors++; LS.set('errors', st.errors); console.warn('sync: dropped', x.k, e2.message); } }
      }
      saveOutbox();
    }
    for (const x of dead) {
      try { await http('/rest/v1/records?household_id=eq.' + hid + '&store=eq.' + encodeURIComponent(x.store) + '&id=eq.' + encodeURIComponent(x.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { deleted: true, data: null } }); outbox.delete(x.k);
        if (x.store === 'files') { blobq.delete(x.id); http('/storage/v1/object/files/' + hid + '/' + x.id, { method: 'DELETE' }).catch(() => { }); } }
      catch (e) { if (isFatal(e)) { saveOutbox(); throw e; } outbox.delete(x.k); }
    }
    saveOutbox(); await pushBlobs();
  }
  async function pushBlobs() {
    for (const id of [...blobq]) {
      if (!Fin.get(S, 'files', id)) { blobq.delete(id); continue; }
      const b = await DB.getBlob(id); if (!b) { blobq.delete(id); continue; }
      try { await http('/storage/v1/object/files/' + meta.householdId + '/' + id, { method: 'POST', headers: { 'x-upsert': 'true', 'Content-Type': b.type || 'application/octet-stream' }, body: b, timeout: 120000 }); blobq.delete(id); }
      catch (e) { if (isFatal(e)) { saveOutbox(); throw e; } console.warn('blob upload failed', id, e.message); }
    }
    saveOutbox();
  }
  const inflight = {};
  async function fetchBlob(id) {
    if (!linked() || !navigator.onLine) return false; if (inflight[id]) return inflight[id];
    return inflight[id] = (async () => { try { const b = await http('/storage/v1/object/authenticated/files/' + meta.householdId + '/' + id, { blob: true, timeout: 120000 }); await DB.putBlob(id, b); return true; } catch (e) { return false; } finally { delete inflight[id]; } })();
  }

  /* ---------- pull ---------- */
  async function pullMembers() {
    const hh = await myHousehold(); if (!hh) throw cerr('NO_HOUSEHOLD');
    const before = [...memberIds()].sort().join(',');
    adoptHousehold(hh);
    for (const m of hh.members) {
      let u = S.users.find(x => x.id === m.user_id);
      if (!u) { u = { id: m.user_id, name: m.name, role: m.role, salt: null, pinHash: null, createdAt: new Date().toISOString(), cloud: true }; S.users.push(u); S.dirty.push(['users', u.id]); }
      else if (u.name !== m.name || u.role !== m.role) { u.name = m.name; u.role = m.role; S.dirty.push(['users', u.id]); }
      if (u.id === session.user.id && App.user && App.user.id === u.id) App.user = u;
    }
    if (before !== [...memberIds()].sort().join(',')) markAllPending();    // membership changed → re-publish with updated reader lists
  }
  function apply(rows) {
    let changed = 0;
    for (const r of rows) {
      if (!SYNC.includes(r.store)) continue; const key = r.store + '|' + r.id; if (outbox.has(key)) continue;
      const ex = Fin.get(S, r.store, r.id);
      if (r.deleted) { if (ex) { skip.add(key); Fin.remove(S, r.store, r.id); changed++; if (r.store === 'files') DB.delBlob(r.id); } continue; }
      if (!r.data || (ex && JSON.stringify(ex) === JSON.stringify(r.data))) continue;
      skip.add(key); Fin.put(S, r.store, r.data); changed++;
    }
    return changed;
  }
  async function pull() {
    let since = meta.cursor ? new Date(new Date(meta.cursor).getTime() - 120000).toISOString() : null, newest = meta.cursor, changed = 0;
    for (let guard = 0; guard < 200; guard++) {
      const q = '/rest/v1/records?select=store,id,data,deleted,updated_at&household_id=eq.' + meta.householdId + (since ? '&updated_at=gt.' + encodeURIComponent(since) : '') + '&order=updated_at.asc&limit=500';
      const rows = await http(q); if (!rows.length) break;
      changed += apply(rows); newest = rows[rows.length - 1].updated_at;
      if (rows.length < 500) break;
      const ns = new Date(newest).getTime(), ps = since ? new Date(since).getTime() : 0; since = new Date(Math.max(ns, ps + 1)).toISOString();
    }
    await DB.flush(S);
    if (newest) { meta.cursor = newest; LS.set('meta', meta); }
    return changed;
  }

  /* ---------- sync cycle ---------- */
  let running = false, again = false, timer = null;
  async function sync() {
    if (!linked() || !S) return false;
    if (!navigator.onLine) { st.state = 'offline'; emit(); return false; }
    if (running) { again = true; return false; }
    running = true; st.state = 'syncing'; st.error = null; emit(); let changed = 0;
    try {
      await pullMembers(); await DB.flush(S);
      await push(); changed = await pull();
      st.state = 'idle'; st.last = new Date().toISOString(); LS.set('last', st.last);
    } catch (e) { st.state = e.code === 'NETWORK' ? 'offline' : (e.code === 'NOT_SIGNED_IN' ? 'login' : 'error'); st.error = e.code + ': ' + e.message; console.warn('sync failed', e); }
    finally { running = false; emit(); }
    if (changed && typeof App !== 'undefined' && !document.querySelector('.scrim, .notepage')) App.render();
    if (again) { again = false; schedule(500); }
    return st.state === 'idle';
  }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(sync, ms == null ? 1500 : ms); }
  function onFlush(dirty, removed) {
    if (!linked()) return; let any = false;
    for (const [store, id] of dirty.concat(removed)) {
      if (!SYNC.includes(store)) continue; const key = store + '|' + id;
      if (skip.has(key)) { skip.delete(key); continue; }
      outbox.add(key); any = true;
    }
    if (any) { saveOutbox(); emit(); schedule(); }
  }
  function start(state) {
    S = state; DB.setHook(onFlush);
    if (linked() && S.settings.cloudEpoch !== meta.epoch) { meta.cursor = null; LS.set('meta', meta); S.settings.cloudEpoch = meta.epoch; S.dirty.push(['settings', 'cloudEpoch']); markAllPending(); }
    setInterval(() => { if (linked() && !document.hidden) sync(); }, 20000);
    window.addEventListener('online', () => schedule(300)); document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(300); });
    if (linked()) schedule(800);
  }
  function unlink() { ['session', 'meta', 'outbox', 'blobq', 'last', 'errors'].forEach(LS.del); session = null; meta = null; outbox = new Set(); blobq = new Set(); st.state = 'idle'; emit(); }

  /* ---------- high-level flows used by the UI ---------- */
  async function connect({ email, password, name, mode, houseName, code }) {
    if (mode === 'signup') await signUp(email, password, name); else await signIn(email, password);
    let hh = await myHousehold();
    if (!hh) {
      if (code) await joinHousehold(code, name); else await createHousehold(houseName || 'MyLife', name);
      hh = await myHousehold();
    }
    adoptHousehold(hh); return hh;
  }
  const needHousehold = async (email, password, name, mode) => { if (mode === 'signup') await signUp(email, password, name); else await signIn(email, password); return myHousehold(); };
  async function finishLink(hh, display) {   // hh already adopted by connect()
    S.settings.cloudEpoch = meta.epoch; S.dirty.push(['settings', 'cloudEpoch']);
    markAllPending(); await DB.flush(S); return sync();
  }
  return { SYNC, start, sync, schedule, linked, unlink, signUp, signIn, connect, needHousehold, myHousehold, createHousehold, joinHousehold, adoptHousehold, finishLink, remapUserId, markAllPending, fetchBlob, readersOf,
    status: () => ({ ...st, linked: linked(), pending: outbox.size, blobs: blobq.size, meta, email: session && session.user.email, userId: session && session.user.id }),
    onChange: f => listeners.push(f), hasSession: () => !!session, _state: () => S, _setState: s => { S = s; } };
})();
