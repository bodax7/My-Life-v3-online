/* MyLife — notes, voice notes, files, receipt scanning */
(() => {
  const { h, t, S } = App;

  /* ---------- HTML sanitising for rich notes (allow-list) ---------- */
  const OK_TAGS = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'A', 'DIV', 'SPAN', 'IMG']);
  App.sanitize = html => {
    const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
    const walk = node => {
      [...node.childNodes].forEach(c => {
        if (c.nodeType === 3) return; if (c.nodeType !== 1) return c.remove();
        if (!OK_TAGS.has(c.tagName)) { c.replaceWith(...c.childNodes); return walk(node); }
        const keep = {}; if (c.tagName === 'A') { const hr = c.getAttribute('href') || ''; if (/^(https?:|mailto:|tel:)/i.test(hr)) keep.href = hr; }
        if (c.tagName === 'IMG') { if (c.dataset.fid) keep['data-fid'] = c.dataset.fid; else return c.remove(); }
        if (c.tagName === 'DIV' && c.classList.contains('vn') && c.dataset.aid) { keep.class = 'vn'; keep['data-aid'] = c.dataset.aid; c.textContent = ''; }
        else if (c.tagName === 'DIV' && c.classList.contains('fl') && c.dataset.fid) { keep.class = 'fl'; keep['data-fid'] = c.dataset.fid; c.textContent = ''; }
        if (c.tagName === 'LI' && c.dataset.done != null) keep['data-done'] = c.dataset.done === '1' ? '1' : '0';
        if (c.tagName === 'UL' && c.classList.contains('check')) keep.class = 'check';
        [...c.attributes].forEach(a => c.removeAttribute(a.name)); Object.entries(keep).forEach(([k, v]) => c.setAttribute(k, v));
        if (c.tagName === 'A') { c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener noreferrer'); }
        walk(c);
      });
    };
    walk(doc.body); return doc.body.innerHTML;
  };
  App.hydrate = el => {
    el.querySelectorAll('img[data-fid]').forEach(async i => { const u = await App.blobURL(i.dataset.fid); if (u) i.src = u; });
    el.querySelectorAll('div.vn[data-aid]').forEach(async d => { d.setAttribute('contenteditable', 'false'); const f = Fin.get(S, 'files', d.dataset.aid); const u = await App.blobURL(d.dataset.aid);
      d.replaceChildren(h('div', { class: 'vn-t' }, '🎙️ ' + (f ? f.name : '') + (f && f.duration ? ' · ' + App.fmtDur(f.duration) : '')), u ? h('audio', { controls: true, src: u, preload: 'metadata' }) : h('small', {}, t('file_missing'))); });
    el.querySelectorAll('div.fl[data-fid]').forEach(d => { d.setAttribute('contenteditable', 'false'); const f = Fin.get(S, 'files', d.dataset.fid); d.replaceChildren(h('button', { type: 'button', class: 'chip', onclick: () => f && App.viewFile(f) }, '📎 ' + (f ? f.name : '?'))); });
  };
  const checkToggle = e => { const li = e.target.closest && e.target.closest('ul.check > li'); if (!li) return; const r = li.getBoundingClientRect(); const dist = document.dir === 'rtl' || document.documentElement.dir === 'rtl' ? r.right - e.clientX : e.clientX - r.left; if (dist >= 0 && dist < 34) { li.dataset.done = li.dataset.done === '1' ? '0' : '1'; return true; } };

  /* ---------- notes list ---------- */
  const NF = { q: '', category: '', sort: 'updated', favorites: false, tag: '' };
  const CATS = ['personal', 'household', 'shopping', 'financial', 'work', 'ideas', 'important'];
  const catOptions = () => [...CATS, ...App.get('customNoteCats', [])].map(c => [c, CATS.includes(c) ? t('nc_' + c) : c]);

  App.screens.notes = (sub) => {
    sub = sub || 'notes';
    return h('div', {}, App.chips([['notes', t('notes')], ['voice', t('voice_notes')], ['files', t('files')]], sub, v => App.go('notes', v)), sub === 'voice' ? voiceList() : sub === 'files' ? filesList() : notesList());
  };
  function notesList() {
    const list = Life.listNotes(S, App.user, NF);
    const q = App.input('search', { ph: t('search_notes'), value: NF.q }); q.addEventListener('change', () => { NF.q = q.value; App.render(); });
    const sort = App.select([['updated', t('sort_updated')], ['created', t('sort_created')], ['category', t('sort_category')], ['tags', t('sort_tags')], ['favorites', t('sort_favorites')]], NF.sort); sort.addEventListener('change', () => { NF.sort = sort.value; App.render(); });
    const tags = [...new Set(S.notes.filter(n => Life.canViewNote(n, App.user)).flatMap(n => n.tags || []))];
    const catSel = App.select([['', t('all_categories')], ...catOptions()], NF.category); catSel.addEventListener('change', () => { NF.category = catSel.value; App.render(); });
    return h('div', {}, q, h('div', { class: 'grid2', style: { marginTop: '8px' } }, sort, catSel),
      h('div', { class: 'chips' }, h('button', { class: 'chip' + (NF.favorites ? ' on' : ''), onclick: () => { NF.favorites = !NF.favorites; App.render(); } }, '⭐ ' + t('favorites')), tags.map(tg => h('button', { class: 'chip' + (NF.tag === tg ? ' on' : ''), onclick: () => { NF.tag = NF.tag === tg ? '' : tg; App.render(); } }, '#' + tg))),
      list.length ? list.map(n => h('button', { class: 'note-card', onclick: () => App.noteEditor(n) },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } }, h('b', {}, (n.pinned ? '📌 ' : '') + (n.title || t('untitled'))), h('span', {}, (n.favorite ? '⭐' : '') + (n.visibility === 'household' ? ' 🏠' : n.visibility === 'custom' ? ' 👥' : ' 🔒'))),
        h('div', { class: 'small muted', style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, Life.stripHtml(n.html).slice(0, 90)),
        h('div', { class: 'small muted' }, (CATS.includes(n.category) ? t('nc_' + n.category) : n.category) + ' · ' + App.dateTime(n.updatedAt) + ((n.html.match(/<img/g) || []).length ? ' · 🖼️' + App.num((n.html.match(/<img/g) || []).length) : '') + ((n.html.match(/class="vn"/g) || []).length ? ' · 🎙️' + App.num((n.html.match(/class="vn"/g) || []).length) : '') + ((n.html.match(/class="fl"/g) || []).length ? ' · 📎' + App.num((n.html.match(/class="fl"/g) || []).length) : '') + (n.ownerId !== App.user.id ? ' · ' + App.userName(n.ownerId) : '')))) : App.empty(t('no_notes')),
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: () => App.noteEditor() }, '+ ' + t('add_note'))));
  }
  /* ---------- note editor: a full-screen notebook page; photos, voice and files live inline inside the text ---------- */
  App.noteEditor = (note) => {
    const ex = note || null; const canEdit = !ex || Life.canEditNote(ex, App.user); const id = ex ? ex.id : Fin.uid();
    const added = new Set(); let exists = !!ex; let closed = false; let timer = null; let chain = Promise.resolve(); let sel = null;
    const st = { fav: ex ? ex.favorite : false, pin: ex ? ex.pinned : false, vis: ex ? ex.visibility : 'private', shared: ex ? [...(ex.sharedWith || [])] : [], cat: ex ? ex.category : 'personal', tags: ex ? (ex.tags || []).join(', ') : '' };
    const title = App.input('text', { ph: t('title'), value: ex ? ex.title : '' }); title.className = 'np-title'; title.readOnly = !canEdit;
    const editor = h('div', { class: 'editor rich paper', contenteditable: canEdit ? 'true' : 'false', 'data-ph': t('note_ph'), html: App.sanitize(ex ? ex.html : '') }); App.hydrate(editor);
    const status = h('span', { class: 'small muted' }, ex ? App.dateTime(ex.updatedAt) : '');
    const refsOf = html => [...String(html).matchAll(/data-(?:fid|aid)="([^"]+)"/g)].map(m => m[1]);
    const getHtml = () => { const c = editor.cloneNode(true); c.querySelectorAll('img[data-fid]').forEach(i => i.removeAttribute('src')); return App.sanitize(c.innerHTML); };
    const legacyBox = h('div', { class: 'chips' });
    const drawLegacy = () => { const n = Fin.get(S, 'notes', id); const refs = refsOf(getHtml()); const rest = ((n && n.attachments) || []).filter(f => !refs.includes(f)).map(f => Fin.get(S, 'files', f)).filter(Boolean); legacyBox.replaceChildren(...(rest.length ? [h('span', { class: 'small muted' }, t('legacy_attach') + ':'), ...rest.map(f => h('button', { class: 'chip', onclick: () => App.viewFile(f) }, (f.kind === 'audio' ? '🎙️ ' : f.kind === 'image' ? '🖼️ ' : '📎 ') + f.name))] : [])); };
    const doSave = () => { if (!canEdit || closed && false) return; const html = getHtml(); const refs = refsOf(html);
      if (!exists && !title.value.trim() && !Life.stripHtml(html) && !refs.length) return;
      const n0 = Fin.get(S, 'notes', id); const base = ((n0 && n0.attachments) || []).filter(f => !added.has(f)); const attachments = [...new Set([...base, ...refs])];
      return App.act(() => Life.saveNote(S, App.user, { id, title: title.value, html, category: st.cat, tags: String(st.tags).split(/[,،]/), favorite: st.fav, pinned: st.pin, visibility: st.vis, sharedWith: st.shared, attachments })).then(r => { if (r.ok) { exists = true; status.textContent = t('autosaved') + ' ✓'; drawLegacy(); } return r; }); };
    const saveNow = () => { clearTimeout(timer); chain = chain.then(doSave, doSave); return chain; };
    const schedule = () => { if (!canEdit) return; clearTimeout(timer); status.textContent = '…'; timer = setTimeout(saveNow, 1200); };
    const onSel = () => { const g = getSelection(); if (g.rangeCount && editor.contains(g.anchorNode)) sel = g.getRangeAt(0).cloneRange(); };
    document.addEventListener('selectionchange', onSel);
    const restore = () => { editor.focus(); const g = getSelection(); if (sel && editor.contains(sel.startContainer)) { g.removeAllRanges(); g.addRange(sel); } else { const r = document.createRange(); r.selectNodeContents(editor); r.collapse(false); g.removeAllRanges(); g.addRange(r); } };
    const insertBlock = html => { restore(); document.execCommand('insertHTML', false, html); App.hydrate(editor); onSel(); schedule(); };
    const cmd = (c, v) => () => { restore(); document.execCommand(c, false, v); schedule(); };
    const insertImg = async f => { if (!f) return; const rec = await App.saveAttachment(f, { kind: 'note', id }); added.add(rec.id); const url = await App.blobURL(rec.id); insertBlock(`<div><img data-fid="${rec.id}" src="${url}"></div><div><br></div>`); };
    const insertFile = async f => { if (!f) return; const rec = await App.saveAttachment(f, { kind: 'note', id }); added.add(rec.id); insertBlock(rec.kind === 'image' ? `<div><img data-fid="${rec.id}"></div><div><br></div>` : `<div class="fl" data-fid="${rec.id}"></div><div><br></div>`); };
    editor.addEventListener('input', schedule); title.addEventListener('input', schedule);
    title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); editor.focus(); } });
    editor.addEventListener('click', e => { if (checkToggle(e)) { e.preventDefault(); schedule(); return; } const im = e.target.closest && e.target.closest('img[data-fid]'); if (im) { const f = Fin.get(S, 'files', im.dataset.fid); f && App.viewFile(f); } });
    editor.addEventListener('paste', e => { e.preventDefault(); const tx = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, tx); });
    const page = h('div', { class: 'notepage' }); const vv = window.visualViewport;
    const fit = () => { if (vv) { page.style.height = vv.height + 'px'; page.style.top = vv.offsetTop + 'px'; } };
    if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit(); }
    const close = async () => {
      if (closed) return; closed = true; await saveNow(); document.removeEventListener('selectionchange', onSel); if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); }
      const keep = refsOf(getHtml()); for (const fid of added) if (!keep.includes(fid) || !exists) { Fin.remove(S, 'files', fid); await DB.delBlob(fid); } if (added.size) await DB.flush(S);
      page.remove(); App.render(); };
    const options = () => App.sheet(t('options'), s => {
      const cat = App.select(catOptions(), st.cat), tags = App.input('text', { ph: t('tags_ph'), value: st.tags });
      const shareBox = h('div', { class: 'field' }, App.field(t('share_with'), h('div', { class: 'cats' }, S.users.filter(u => u.id !== App.user.id).map(u => { const b = h('button', { type: 'button', class: st.shared.includes(u.id) ? 'on' : '', onclick: () => { st.shared = st.shared.includes(u.id) ? st.shared.filter(x => x !== u.id) : [...st.shared, u.id]; b.classList.toggle('on'); } }, u.name); return b; })))); shareBox.hidden = st.vis !== 'custom';
      const vis = App.seg([['private', '🔒 ' + t('private')], ['household', '🏠 ' + t('household')], ['custom', '👥 ' + t('custom_sharing')]], st.vis, v => { st.vis = v; shareBox.hidden = v !== 'custom'; });
      return h('div', {}, App.field(t('category'), cat), App.field(t('tags'), tags), App.field(t('visibility'), vis), shareBox,
        h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: () => { st.cat = cat.value; st.tags = tags.value; s.close(); schedule(); } }, t('ok')),
          exists && (ex ? ex.ownerId === App.user.id : true) ? h('button', { class: 'btn danger', onclick: async () => { if (!(await App.confirm(t('confirm_delete'), { danger: true, ok: t('delete') }))) return; s.close(); closed = true; clearTimeout(timer); await chain; const n = Fin.get(S, 'notes', id); for (const fid of new Set([...(n ? n.attachments || [] : []), ...added])) await DB.delBlob(fid); await App.act(() => Life.deleteNote(S, App.user, id)); document.removeEventListener('selectionchange', onSel); page.remove(); App.render(); } }, t('delete')) : null));
    });
    const tbtn = (lbl, fn, ttl, extra) => h('button', { type: 'button', title: ttl, 'aria-label': ttl, class: extra || '', onmousedown: e => e.preventDefault(), onclick: fn }, lbl);
    const favB = h('button', { class: 'iconbtn', onclick: () => { st.fav = !st.fav; favB.textContent = st.fav ? '⭐' : '☆'; schedule(); }, 'aria-label': t('favorite') }, st.fav ? '⭐' : '☆');
    const pinB = h('button', { class: 'iconbtn', onclick: () => { st.pin = !st.pin; pinB.style.opacity = st.pin ? 1 : .4; schedule(); }, 'aria-label': t('pin') }, '📌'); pinB.style.opacity = st.pin ? 1 : .4;
    page.append(
      h('div', { class: 'np-top' }, h('button', { class: 'iconbtn', onclick: close, 'aria-label': t('back') }, App.lang === 'ar' ? '→' : '←'), h('div', { class: 'grow' }, status),
        canEdit ? [favB, pinB, h('button', { class: 'iconbtn', onclick: options, 'aria-label': t('options') }, '⚙️')] : null, h('button', { class: 'btn primary sm', onclick: close }, canEdit ? '✓ ' + t('save') : t('close'))),
      h('div', { class: 'np-scroll' }, title, editor, legacyBox, canEdit ? null : h('div', { class: 'small muted', style: { padding: '8px 14px' } }, App.userName(ex.ownerId))),
      canEdit ? h('div', { class: 'np-tools' }, tbtn('☑', () => insertBlock('<ul class="check"><li data-done="0"><br></li></ul>'), t('checklist')), tbtn('B', cmd('bold'), t('bold'), 'b'), tbtn('I', cmd('italic'), t('italic'), 'i'), tbtn('H', cmd('formatBlock', 'h2'), t('heading')), tbtn('•', cmd('insertUnorderedList'), t('bullets')), tbtn('1.', cmd('insertOrderedList'), t('numbered')),
        tbtn('🖼️', async () => insertImg(await App.pickFile('image/*')), t('image')), tbtn('📷', async () => insertImg(await App.pickFile('image/*', 'environment')), t('camera')),
        tbtn('🎙️', () => { onSel(); App.voiceSheet({ noteId: id, onSaved: rec => { added.add(rec.id); setTimeout(() => insertBlock(`<div class="vn" data-aid="${rec.id}" contenteditable="false"></div><div><br></div>`), 0); } }); }, t('voice_in_note')),
        tbtn('📎', async () => insertFile(await App.pickFile('*/*')), t('attach_file')), tbtn('🔗', () => { onSel(); const u = prompt(t('link_url'), 'https://'); if (u) cmd('createLink', u)(); }, t('link'))) : null);
    document.body.append(page); drawLegacy(); if (!ex) title.focus();
  };

  /* ---------- voice notes ---------- */
  App.voiceSheet = (o) => {
    o = o || {};
    if (!navigator.mediaDevices || !window.MediaRecorder) return App.toast(t('voice_unsupported'), 'err');
    const st = { rec: null, chunks: [], ms: 0, last: 0, timer: null, state: 'idle', blob: null, stream: null };
    const timer = h('div', { style: { fontSize: '40px', fontWeight: 800, textAlign: 'center', margin: '10px 0' } }, '0:00'); const body = h('div');
    const tick = () => { if (st.state === 'recording') { const n = Date.now(); st.ms += n - st.last; st.last = n; } timer.textContent = App.fmtDur(st.ms / 1000); };
    const stopStream = () => { clearInterval(st.timer); st.stream && st.stream.getTracks().forEach(x => x.stop()); };
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
    const sh = App.sheet(t('voice_notes'), s => {
      const orig = s.close; s.close = () => { stopStream(); if (st.rec && st.rec.state !== 'inactive') try { st.rec.stop(); } catch (e) { } orig(); };
      const draw = () => {
        const kids = [timer];
        if (st.state === 'idle') kids.push(h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: start }, '🎙️ ' + t('start_recording'))), h('p', { class: 'small muted' }, t('voice_offline_note')));
        else if (st.state === 'recording' || st.state === 'paused') kids.push(h('div', { class: 'rec', style: { justifyContent: 'center' } }, st.state === 'recording' ? h('span', { class: 'pulse' }) : null, h('span', {}, st.state === 'recording' ? t('recording') : t('paused'))),
          h('div', { class: 'btns' }, st.state === 'recording' ? h('button', { class: 'btn', onclick: () => { st.rec.pause(); st.state = 'paused'; draw(); } }, '⏸ ' + t('pause')) : h('button', { class: 'btn', onclick: () => { st.rec.resume(); st.last = Date.now(); st.state = 'recording'; draw(); } }, '▶ ' + t('resume')), h('button', { class: 'btn danger', onclick: () => { st.rec.stop(); } }, '⏹ ' + t('stop'))));
        else {
          const nm = App.input('text', { value: t('voice_default_name') + ' ' + App.dateTime(new Date().toISOString()) }), tg = App.input('text', { ph: t('tags_ph') }), sharedChk = h('input', { type: 'checkbox' });
          const notes = Life.listNotes(S, App.user, {}).filter(n => Life.canEditNote(n, App.user)); const nsel = App.select([['', t('none')], ...notes.map(n => [n.id, n.title || t('untitled')])], o.noteId || '');
          const url = URL.createObjectURL(st.blob);
          kids.push(h('audio', { controls: true, src: url, style: { width: '100%' } }), App.field(t('name'), nm), App.field(t('tags'), tg), !o.noteId ? App.field(t('attach_to_note'), nsel) : null, h('div', { class: 'switch' }, h('label', {}, sharedChk, ' ' + t('share_household')), ''),
            h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: async () => {
              const r = await App.act(async () => { const ext = /mp4/.test(st.blob.type) ? 'm4a' : /ogg/.test(st.blob.type) ? 'ogg' : 'webm'; const nid = o.noteId || nsel.value || null; const rec = Life.addFile(S, App.user, { name: nm.value.trim() || 'voice', mime: st.blob.type, size: st.blob.size, kind: 'audio', parent: nid ? { kind: 'note', id: nid } : null, shared: sharedChk.checked, tags: tg.value.split(/[,،]/).map(x => x.trim()).filter(Boolean), duration: st.ms / 1000 });
                rec.recording = true; Fin.put(S, 'files', rec); await DB.putBlob(rec.id, st.blob);
                if (nid && !o.noteId) { const n = Fin.get(S, 'notes', nid); if (n) Fin.put(S, 'notes', { ...n, attachments: [...(n.attachments || []), rec.id], updatedAt: new Date().toISOString() }); }
                o.onSaved && o.onSaved(rec); return rec; }, t('saved')); if (r.ok) { s.close(); App.render(); } } }, t('save')), h('button', { class: 'btn', onclick: () => { st.blob = null; st.ms = 0; st.state = 'idle'; draw(); } }, t('discard'))));
        }
        body.replaceChildren(...kids.filter(Boolean));
      };
      const start = async () => {
        try { st.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { return App.toast(e && e.name === 'NotAllowedError' ? t('mic_denied') : t('mic_error'), 'err'); }
        st.rec = new MediaRecorder(st.stream, mime ? { mimeType: mime } : undefined); st.chunks = []; st.ms = 0;
        st.rec.ondataavailable = e => e.data && e.data.size && st.chunks.push(e.data);
        st.rec.onstop = () => { stopStream(); tick(); st.blob = new Blob(st.chunks, { type: st.rec.mimeType || mime || 'audio/webm' }); st.state = 'stopped'; draw(); };
        st.rec.start(1000); st.state = 'recording'; st.last = Date.now(); st.timer = setInterval(tick, 250); draw();
      };
      draw(); return body;
    });
  };
  function voiceList() {
    const q = App.input('search', { ph: t('search_voice') }); const wrap = h('div'); const draw = () => {
      const vs = S.files.filter(f => f.kind === 'audio' && f.recording && Life.canViewFile(S, f, App.user) && (!q.value || Life.norm(f.name + ' ' + (f.tags || []).join(' ')).includes(Life.norm(q.value)))).sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
      wrap.replaceChildren(...(vs.length ? vs.map(v => { const audio = h('audio', { controls: true, style: { width: '100%' }, preload: 'none' }); App.blobURL(v.id).then(u => { if (u) audio.src = u; });
        return h('div', { class: 'card' }, h('div', { class: 'row', style: { borderBottom: 0 } }, h('div', { class: 'avatar' }, '🎙️'), h('div', { class: 'grow' }, h('div', { class: 'title' }, v.name), h('div', { class: 'sub' }, App.dateTime(v.createdAt) + ' · ' + App.fmtDur(v.duration) + (v.ownerId !== App.user.id ? ' · ' + App.userName(v.ownerId) : '') + (v.shared ? ' · 🏠' : ''))), ''), audio,
          (v.tags || []).length ? h('div', { class: 'small muted' }, v.tags.map(x => '#' + x).join(' ')) : null,
          v.ownerId === App.user.id ? h('div', { class: 'btns' }, h('button', { class: 'btn sm', onclick: async () => { const n = prompt(t('rename'), v.name); if (n) { await App.act(() => Fin.put(S, 'files', { ...v, name: n })); App.render(); } } }, t('rename')), h('button', { class: 'btn sm', onclick: async () => { await App.act(() => Fin.put(S, 'files', { ...v, shared: !v.shared })); App.render(); } }, v.shared ? t('unshare') : t('share_household')), h('button', { class: 'btn sm danger', onclick: async () => { if (await App.confirm(t('confirm_delete'), { danger: true, ok: t('delete') })) { await App.act(() => { Fin.remove(S, 'files', v.id); S.notes.filter(n => (n.attachments || []).includes(v.id)).forEach(n => Fin.put(S, 'notes', { ...n, attachments: n.attachments.filter(x => x !== v.id) })); }); await DB.delBlob(v.id); App.render(); } } }, t('delete'))) : null); }) : [App.empty(t('no_voice'))]));
    }; q.addEventListener('input', draw); draw();
    return h('div', {}, q, wrap, h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: () => App.voiceSheet() }, '🎙️ ' + t('start_recording'))));
  }

  /* ---------- files list ---------- */
  function filesList() {
    const fs = S.files.filter(f => Life.canViewFile(S, f, App.user) && !f.recording).sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
    return h('div', {}, h('div', { class: 'card' }, fs.length ? fs.map(f => h('div', { class: 'row' }, h('div', { class: 'avatar tap', onclick: () => App.viewFile(f) }, f.kind === 'image' ? '🖼️' : f.kind === 'audio' ? '🎙️' : '📄'), h('div', { class: 'grow tap', onclick: () => App.viewFile(f) }, h('div', { class: 'title' }, f.name), h('div', { class: 'sub' }, (f.parent ? t('parent_' + f.parent.kind) + ' · ' : '') + Math.round((f.size || 0) / 1024) + ' KB · ' + App.dateTime(f.createdAt))),
      f.ownerId === App.user.id ? h('button', { class: 'btn sm', onclick: async () => { const n = prompt(t('rename'), f.name); if (n) { await App.act(() => Fin.put(S, 'files', { ...f, name: n })); App.render(); } } }, '✏️') : null,
      f.ownerId === App.user.id ? h('button', { class: 'btn sm danger', onclick: async () => { if (await App.confirm(t('confirm_delete'), { danger: true, ok: t('delete') })) { await App.act(() => detachFile(f)); await DB.delBlob(f.id); App.render(); } } }, '🗑') : null)) : App.empty(t('no_files'))),
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: async () => { const f = await App.pickFile('*/*'); if (f) { await App.act(() => App.saveAttachment(f, null), t('saved')); App.render(); } } }, '📎 ' + t('upload_file')), h('button', { class: 'btn', onclick: async () => { const f = await App.pickFile('image/*', 'environment'); if (f) { await App.act(() => App.saveAttachment(f, null), t('saved')); App.render(); } } }, '📷 ' + t('camera'))));
  }
  function detachFile(f) {
    Fin.remove(S, 'files', f.id);
    S.notes.filter(n => (n.attachments || []).includes(f.id)).forEach(n => Fin.put(S, 'notes', { ...n, attachments: n.attachments.filter(x => x !== f.id) }));
    S.tasks.filter(x => (x.attachments || []).includes(f.id)).forEach(x => Fin.put(S, 'tasks', { ...x, attachments: x.attachments.filter(y => y !== f.id) }));
    S.transactions.filter(x => (x.attachments || []).includes(f.id)).forEach(x => Fin.put(S, 'transactions', { ...x, attachments: x.attachments.filter(y => y !== f.id) }));
  }

  /* ---------- receipt scanning (camera/upload -> crop/rotate -> OCR -> editable confirmation) ---------- */
  let tessPromise = null;
  const loadTess = () => tessPromise || (tessPromise = new Promise((res, rej) => { if (window.Tesseract) return res(window.Tesseract); const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'; s.onload = () => res(window.Tesseract); s.onerror = () => { tessPromise = null; rej(new Error('ocr_load')); }; document.head.append(s); }));
  App.scanReceipt = async (file) => {
    file = file || await App.pickFile('image/*', 'environment'); if (!file) return;
    const img = new Image(); const url = URL.createObjectURL(file); await new Promise(r => { img.onload = r; img.src = url; });
    const st = { rot: 0, l: 0, r: 0, tp: 0, b: 0 }; const canvas = h('canvas', { style: { maxWidth: '100%', borderRadius: '12px', background: '#000' } });
    const draw = () => { const sw = st.rot % 180 ? img.height : img.width, sh = st.rot % 180 ? img.width : img.height; const tmp = document.createElement('canvas'); tmp.width = sw; tmp.height = sh; const c = tmp.getContext('2d'); c.translate(sw / 2, sh / 2); c.rotate(st.rot * Math.PI / 180); c.drawImage(img, -img.width / 2, -img.height / 2);
      const x = sw * st.l / 100, y = sh * st.tp / 100, w = sw * (100 - st.l - st.r) / 100, hh = sh * (100 - st.tp - st.b) / 100; const sc = Math.min(1, 1600 / Math.max(w, hh)); canvas.width = Math.max(1, Math.round(w * sc)); canvas.height = Math.max(1, Math.round(hh * sc)); canvas.getContext('2d').drawImage(tmp, x, y, w, hh, 0, 0, canvas.width, canvas.height); };
    const slider = (k, lbl) => h('div', { class: 'field' }, h('label', {}, lbl), h('input', { type: 'range', min: 0, max: 40, value: 0, style: { width: '100%' }, oninput: e => { st[k] = Number(e.target.value); draw(); } }));
    const status = h('div', { class: 'small muted' });
    App.sheet(t('scan_receipt'), s => { draw(); return h('div', {}, h('div', { class: 'banner' }, t('ocr_limits')), canvas, h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { st.rot = (st.rot + 90) % 360; draw(); } }, '⟳ ' + t('rotate'))),
      h('div', { class: 'grid2' }, slider('tp', t('crop_top')), slider('b', t('crop_bottom')), slider('l', t('crop_left')), slider('r', t('crop_right'))), status,
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: async (ev) => {
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85)); const f2 = new File([blob], 'receipt-' + App.today() + '.jpg', { type: 'image/jpeg' });
        const finish = (p) => { s.close(); App.txSheet({ type: 'expense', amount: p.total || undefined, description: p.merchant || '', date: p.date || App.today(), categoryId: p.categoryId, notes: p.tax ? t('tax') + ': ' + App.moneyTxt(p.tax, p.currency) : '', files: [f2] }); };
        ev.target.disabled = true; status.textContent = t('ocr_running');
        try { const T = await loadTess(); const res = await T.recognize(blob, 'ara+eng'); const parsed = Fin.parseReceiptText(res.data.text); status.textContent = ''; App.toast(t('ocr_review'), 'ok'); finish(parsed); }
        catch (e) { status.textContent = ''; App.toast(t('ocr_unavailable'), 'err'); finish({}); } } }, '🔍 ' + t('extract_text')), h('button', { class: 'btn', onclick: async () => { const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85)); s.close(); App.txSheet({ type: 'expense', files: [new File([blob], 'receipt-' + App.today() + '.jpg', { type: 'image/jpeg' })] }); } }, t('skip_ocr')), h('button', { class: 'btn', onclick: s.close }, t('cancel')))); });
  };
})();
