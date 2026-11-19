/* MyLife — cloud sync screens (sign in / create or join household / status) */
(() => {
  const { h, t, S } = App;
  const errText = e => { const k = 'cloud_err_' + String(e.code || '').toLowerCase(); return I18N.has(App.lang, k) ? t(k) : (t('cloud_err_generic') + ' (' + (e.message || e.code) + ')'); };

  App.cloudBadge = () => {
    const s = Cloud.status(); if (!s.linked) return null;
    const m = { idle: '☁️ ' + t('cloud_synced'), syncing: '☁️ ' + t('cloud_syncing'), offline: '☁️ ' + t('cloud_offline'), error: '☁️ ⚠ ' + t('cloud_error'), login: '☁️ ⚠ ' + t('cloud_login_needed') };
    return m[s.state] + (s.pending ? ' · ' + App.num(s.pending) : '');
  };
  Cloud.onChange(() => { const b = document.getElementById('cloudbadge'); if (b) b.textContent = App.cloudBadge() || ''; });

  // pull missing attachment files from the cloud on demand
  const _blobURL = App.blobURL;
  App.blobURL = async id => { let u = await _blobURL(id); if (u) return u; if (Cloud.linked() && Fin.get(S, 'files', id) && await Cloud.fetchBlob(id)) u = await _blobURL(id); return u; };

  // wizard: sign in / sign up, then create or join the household. fresh = brand-new device with no local profile
  App.cloudWizard = (fresh) => {
    const me = App.user;
    App.sheet(t('cloud_connect'), s => {
      let mode = 'signup', role = 'create';
      const email = App.input('email', { ph: 'name@example.com' }), pw = App.input('password', { ph: t('cloud_password') });
      const nm = App.input('text', { ph: t('ob_name_ph'), value: me ? me.name : '' }), hn = App.input('text', { ph: t('cloud_house_name'), value: t('cloud_house_default') }), code = App.input('text', { ph: 'XXXXXXXX' });
      const nameF = App.field(t('ob_name'), nm), roleF = h('div'), houseF = App.field(t('cloud_house_name'), hn), codeF = App.field(t('cloud_join_code'), code);
      const draw = () => { nameF.hidden = mode === 'signin' && !fresh ? true : false; roleF.hidden = mode === 'signin'; houseF.hidden = mode === 'signin' || role !== 'create'; codeF.hidden = mode === 'signin' || role !== 'join'; };
      const modeSeg = App.seg([['signup', t('cloud_new_account')], ['signin', t('cloud_have_account')]], mode, v => { mode = v; draw(); });
      roleF.append(App.seg([['create', t('cloud_create_house')], ['join', t('cloud_join_house')]], role, v => { role = v; draw(); })); draw();
      const btn = h('button', { class: 'btn primary', style: { width: '100%' }, onclick: async () => {
        const em = email.value.trim(), pwd = pw.value; if (!em || pwd.length < 6) return App.toast(t('cloud_err_form'), 'err');
        if (mode === 'signup' && !nm.value.trim()) return App.toast(t('err_NAME_REQUIRED'), 'err');
        if (mode === 'signup' && role === 'join' && !code.value.trim()) return App.toast(t('cloud_err_bad_code'), 'err');
        btn.disabled = true; btn.textContent = '…';
        try {
          const display = (nm.value.trim() || (me && me.name) || em.split('@')[0]);
          let hh;
          if (mode === 'signin') { hh = await Cloud.needHousehold(em, pwd, display, 'signin'); if (!hh) { btn.disabled = false; btn.textContent = t('cloud_connect'); mode = 'signup'; role = 'join'; return App.toast(t('cloud_no_house_yet'), 'err'); } Cloud.adoptHousehold(hh); }
          else hh = await Cloud.connect({ email: em, password: pwd, name: display, mode: 'signup', houseName: hn.value, code: role === 'join' ? code.value : '' });
          const uid = Cloud.status().userId;
          if (fresh || !me) {
            const mine = (hh.members || []).find(m => m.user_id === uid) || { name: display, role: hh.role };
            const u = { id: uid, name: mine.name, role: hh.role, salt: null, pinHash: null, createdAt: new Date().toISOString(), cloud: true };
            Fin.put(S, 'users', u); App.set('created', new Date().toISOString()); App.user = u; sessionStorage.setItem('mylife.user', uid);
          } else {
            Cloud.remapUserId(me.id, uid); const u = S.users.find(x => x.id === uid) || me; u.role = hh.role; S.dirty.push(['users', u.id]); App.user = u;
          }
          await DB.flush(S); s.close(); App.toast(t('cloud_syncing'), 'ok');
          const ok = await Cloud.finishLink(hh, display); App.toast(ok ? t('cloud_done') : t('cloud_first_sync_pending'), ok ? 'ok' : 'err'); App.render();
        } catch (e) { btn.disabled = false; btn.textContent = t('cloud_connect'); App.toast(errText(e), 'err'); }
      } }, t('cloud_connect'));
      return h('div', {}, h('p', { class: 'muted small' }, fresh ? t('cloud_fresh_note') : t('cloud_link_note')), modeSeg, App.field('Email', email), App.field(t('cloud_password'), pw), nameF, roleF, houseF, codeF, btn);
    });
  };

  const ago = iso => iso ? App.dateTime(iso) : '—';
  App.more.cloud = () => {
    const s = Cloud.status();
    if (!s.linked) return h('div', {},
      h('div', { class: 'card' }, h('h3', {}, '☁️ ' + t('cloud_title')), h('p', {}, t('cloud_intro')),
        h('ul', { class: 'small' }, ['cloud_pt1', 'cloud_pt2', 'cloud_pt3', 'cloud_pt4'].map(k => h('li', {}, t(k)))),
        h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: () => App.cloudWizard(false) }, t('cloud_connect')))),
      h('div', { class: 'banner' }, t('cloud_backup_still')));
    const m = s.meta || {};
    return h('div', {},
      h('div', { class: 'card' }, h('h3', {}, '☁️ ' + t('cloud_title')),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'title' }, App.cloudBadge()), h('div', { class: 'sub' }, t('cloud_last') + ': ' + ago(s.last)))),
        s.error ? h('div', { class: 'banner' }, s.error) : null,
        h('div', { class: 'small muted' }, t('cloud_account') + ': ' + (s.email || '') + ' · ' + (m.name || '') + ' · ' + (m.role === 'admin' ? t('role_admin') : t('role_member'))),
        s.errors ? h('div', { class: 'small muted' }, t('cloud_dropped', { n: App.num(s.errors) })) : null,
        h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: async () => { const ok = await Cloud.sync(); App.toast(ok ? t('cloud_done') : errText({ code: 'x', message: (Cloud.status().error || '') }), ok ? 'ok' : 'err'); App.render(); } }, '🔄 ' + t('cloud_sync_now')))),
      m.role === 'admin' && m.code ? h('div', { class: 'card' }, h('h3', {}, t('cloud_join_code')), h('div', { style: { fontSize: '28px', fontWeight: 800, letterSpacing: '4px', textAlign: 'center', direction: 'ltr' } }, m.code), h('p', { class: 'small muted' }, t('cloud_code_note')),
        h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { try { navigator.clipboard.writeText(m.code); App.toast(t('copied'), 'ok'); } catch (e) { } } }, t('copy')))) : null,
      h('div', { class: 'card' }, h('h3', {}, t('household_members')), (m.members || []).map(x => h('div', { class: 'row' }, h('div', { class: 'avatar' }, x.role === 'admin' ? '👤' : '👥'), h('div', { class: 'grow' }, h('div', { class: 'title' }, x.name), h('div', { class: 'sub' }, x.email || ''))))),
      h('div', { class: 'banner' }, t('cloud_privacy_note')),
      h('div', { class: 'card' }, h('div', { class: 'btns' }, h('button', { class: 'btn danger', onclick: async () => { if (!(await App.confirm(t('cloud_unlink_confirm'), { danger: true, ok: t('cloud_unlink') }))) return; Cloud.unlink(); App.toast(t('cloud_unlinked'), 'ok'); App.render(); } }, t('cloud_unlink')))));
  };
})();
