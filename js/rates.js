/* MyLife — live USD/EGP + gold rates, "what counts in my total" picker, storage persistence, share-backup */
(() => {
  const { h, t, S } = App;
  const KARATS = [['G24', 24], ['G21', 21], ['G18', 18]];
  const SRC = 'https://xaus.com/api/v1/spot?currency=EGP&unit=gram';
  const FALLBACK_FX = 'https://open.er-api.com/v6/latest/USD';
  const HOURS = 6;

  App.karatLabel = c => t('karat_n', { n: App.num(c.slice(1)) });
  App.curLabel = c => Fin.isGold(c) ? App.karatLabel(c) : c;

  async function getJSON(url) {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 12000);
    try { const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(tm); }
  }
  // pure parsing (exported for tests): returns { gold24: EGP per gram 24k | null, usd: EGP per USD | null }
  App.parseSpot = j => {
    const num = x => { x = Number(x); return isFinite(x) && x > 0 ? x : null; };
    const usdG = num(j && j.per_gram_usd); let egpG = null, usd = null;
    if (j && j.xau && j.xau.currency === 'EGP' && (!j.xau.unit || j.xau.unit === 'gram')) egpG = num(j.xau.price);
    if (egpG && usdG) usd = egpG / usdG;
    else if (usdG && num(j && j.fx_rate)) { usd = num(j.fx_rate); egpG = usdG * usd; }
    if (usd && (usd < 1 || usd > 5000)) usd = null;
    return { gold24: egpG, usd };
  };
  App.ratesMeta = () => App.get('ratesMeta', null);
  App.refreshRates = async (force) => {
    if (!App.user || !navigator.onLine) return false;
    if (!force && App.get('autoRates', true) === false) return false;
    const meta = App.ratesMeta();
    if (!force && meta && Date.now() - new Date(meta.ts).getTime() < HOURS * 3600e3) return false;
    if (App._ratesBusy) return false; App._ratesBusy = true;
    try {
      let spot = null, src = 'xaus.com';
      try { spot = App.parseSpot(await getJSON(SRC)); } catch (e) { console.warn('gold source failed', e); }
      if (!spot || !spot.usd) { try { const j = await getJSON(FALLBACK_FX); const v = j && j.rates && Number(j.rates.EGP); if (v > 0) { spot = { gold24: spot && spot.gold24, usd: v }; src = 'open.er-api.com (USD)'; } } catch (e) { console.warn('fx fallback failed', e); } }
      if (!spot || (!spot.usd && !spot.gold24)) { if (force) App.toast(t('rates_failed'), 'err'); return false; }
      const prem = Number(App.get('goldPremium', 0)) || 0, d = App.today(); const r4 = x => Math.round(x * 10000) / 10000;
      if (spot.usd) Fin.setRate(S, App.user, 'USD', r4(spot.usd), d);
      if (spot.gold24) for (const [c, k] of KARATS) Fin.setRate(S, App.user, c, r4(spot.gold24 * (1 + prem / 100) * k / 24), d);
      App.set('ratesMeta', { ts: new Date().toISOString(), src, usd: spot.usd || null, gold24: spot.gold24 || null, prem });
      await DB.flush(S);
      if (force) App.toast(t('rates_updated'), 'ok');
      if (!document.querySelector('.scrim, .notepage')) App.render();
      return true;
    } catch (e) { console.warn(e); if (force) App.toast(t('rates_failed'), 'err'); return false; }
    finally { App._ratesBusy = false; }
  };

  // value of an account line in EGP and USD
  App.valueSub = (a, bal) => {
    const rate = Fin.rateFor(S, a.currency);
    if (a.currency === Fin.BASE) return '';
    if (!rate) return Fin.isGold(a.currency) ? t('gold_no_rate') : '';
    const base = Fin.toBase(bal, rate); let s = '≈ ' + App.moneyTxt(base);
    if (Fin.isGold(a.currency)) { const u = Fin.rateFor(S, 'USD'); if (u) s += ' · ≈ ' + Fin.fmtMoney(Math.round(base / u), 'USD', App.lang); }
    return s;
  };
  App.totalExcl = () => App.user ? App.get('totalExcl_' + App.user.id, []) : [];
  App.exclTag = a => App.totalExcl().includes(a.id) ? ' · ' + t('not_in_total') : '';

  App.totalSheet = () => {
    const accs = S.accounts.filter(a => Fin.canView(a, App.user) && a.active !== false);
    const off = new Set(App.totalExcl()); const boxes = {};
    App.sheet(t('choose_total'), s => {
      const list = h('div'); const draw = () => list.replaceChildren(...accs.map(a => h('label', { class: 'row', style: { cursor: 'pointer' } },
        h('input', { type: 'checkbox', checked: !off.has(a.id), onchange: e => { e.target.checked ? off.delete(a.id) : off.add(a.id); } }),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, a.name + (a.visibility === 'household' ? ' 🏠' : ' 🔒')), h('div', { class: 'sub' }, t('at_' + a.type) + ' · ' + App.curLabel(a.currency))))));
      draw();
      const byType = (ty, on) => { accs.filter(a => a.type === ty).forEach(a => on ? off.delete(a.id) : off.add(a.id)); draw(); };
      return h('div', {}, h('p', { class: 'muted small' }, t('choose_total_note')),
        h('div', { class: 'chips' }, h('button', { class: 'chip', onclick: () => { off.clear(); draw(); } }, t('include_all')), h('button', { class: 'chip', onclick: () => byType('savings', false) }, t('exclude_savings')), h('button', { class: 'chip', onclick: () => byType('gold', false) }, t('exclude_gold'))),
        list, h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: async () => { App.set('totalExcl_' + App.user.id, [...off]); await DB.flush(S); s.close(); App.render(); } }, t('save')), h('button', { class: 'btn', onclick: s.close }, t('cancel'))));
    });
  };

  // ask the browser not to evict our data when storage is low (does NOT survive a manual "clear site data")
  App.persistStorage = async () => { try { if (navigator.storage && navigator.storage.persist) { const ok = (await navigator.storage.persisted()) || (await navigator.storage.persist()); App.set('persisted', !!ok); return !!ok; } } catch (e) { } return false; };

  // one-tap share of a full backup (WhatsApp / Drive / email) with download fallback
  App.shareBackup = async () => {
    const txt = await DB.exportAll(S); const name = 'mylife-backup-' + App.today() + '.json';
    const file = new File([txt], name, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'MyLife backup' });
      else App.download(name, txt, 'application/json');
      App.set('lastBackup', new Date().toISOString()); await DB.flush(S); App.toast(t('backup_created_verified'), 'ok'); App.render();
    } catch (e) { if (e && e.name !== 'AbortError') App.toast(t('backup_bad'), 'err'); }
  };
})();
