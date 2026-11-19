import sys, json; sys.path.insert(0,'/tmp/e2e')
from lib import Run
r=Run(); H=r.pg
INIT="localStorage.setItem('mylife.cloud.urlOverride', JSON.stringify('http://localhost:8766'));"
r.ctx.add_init_script(INIT)
ctx2=r.b.new_context(viewport={'width':390,'height':844}); ctx2.add_init_script(INIT)
W=ctx2.new_page(); W.on('pageerror', lambda e: print('W pageerror', e))
H.on('pageerror', lambda e: print('H pageerror', e))
ev=lambda pg,js: pg.evaluate(js)
def names(pg,store): return pg.evaluate("App.S.%s.map(x=>x.name||x.title||x.description||x.id)"%store)
# ---------- H: local data first, then link ----------
r.open(); r.onboard('أحمد','')
ev(H,"""(async()=>{const S=App.S,u=App.user;
 const priv=S.accounts.find(a=>a.visibility==='private'), hh=S.accounts.find(a=>a.visibility==='household');
 const cat=S.categories.find(c=>c.kind==='expense');
 Fin.addTx(S,u,{type:'income',accountId:priv.id,amount:100000,date:Fin.today(),description:'راتب خاص'});
 Fin.addTx(S,u,{type:'expense',accountId:hh.id,amount:10000,date:Fin.today(),categoryId:cat.id,description:'مصروف بيت أحمد'});
 Life.saveNote(S,u,{title:'سر أحمد',html:'<p>خاص</p>',visibility:'private'});
 Life.saveNote(S,u,{title:'ملاحظة مشتركة',html:'<p>للبيت</p>',visibility:'household'});
 await DB.flush(S);})()""")
H.locator('nav.bottom button').nth(4).click(); H.locator('.card.row', has_text='المزامنة السحابية').click(); H.wait_for_timeout(300)
H.locator('.btn.primary', has_text='ربط الجهاز').click(); H.wait_for_selector('.sheet')
H.fill('.sheet input[type=email]','h@x.com'); H.fill('.sheet input[type=password]','123456')
H.locator('.sheet .btn.primary', has_text='ربط الجهاز').click(); H.wait_for_timeout(2500)
print('H status:', ev(H,"Cloud.status().state"), 'pending', ev(H,"Cloud.status().pending"), 'role', ev(H,"App.user.role"), 'id==auth:', ev(H,"App.user.id===Cloud.status().userId"))
H.locator('.card.row', has_text='المزامنة السحابية').count() or None
r.ev("App.go('more','cloud')"); H.wait_for_timeout(300)
code=H.locator('div[style*="letter-spacing"]').inner_text(); print('join code:', code); H.screenshot(path='/tmp/e2e/cloud_H.png', full_page=True)
# ---------- W: fresh device ----------
W.goto('http://localhost:8765/index.html'); W.wait_for_selector('.lock')
W.locator('.btn', has_text='جهاز جديد').click(); W.wait_for_selector('.sheet')
W.locator('.sheet button', has_text='انضم لبيت بكود').click()
W.fill('.sheet input[type=email]','w@x.com'); W.fill('.sheet input[type=password]','abcdef')
W.locator('.sheet input[type=text]').first.fill('سارة'); W.locator('.sheet input[placeholder=XXXXXXXX]').fill(code)
W.locator('.sheet .btn.primary', has_text='ربط الجهاز').click(); W.wait_for_selector('header.top', timeout=8000); W.wait_for_timeout(2500)
print('W user:', ev(W,"App.user.name+'/'+App.user.role"), 'state:', ev(W,"Cloud.status().state"))
print('W accounts:', names(W,'accounts'), '| W notes:', names(W,'notes'), '| W tx desc:', ev(W,"Fin.visibleTx(App.S,App.user).map(t=>t.description)"))
print('categories H vs W:', ev(H,"App.S.categories.length"), ev(W,"App.S.categories.length"))
W.screenshot(path='/tmp/e2e/cloud_W.png', full_page=True)
# ---------- W adds data ----------
ev(W,"""(async()=>{const S=App.S,u=App.user; const hh=S.accounts.find(a=>a.visibility==='household'); const cat=S.categories.find(c=>c.kind==='expense');
 const mine=Fin.createAccount(S,u,{name:'محفظة سارة',type:'wallet',visibility:'private',opening:50000});
 Fin.addTx(S,u,{type:'expense',accountId:hh.id,amount:3000,date:Fin.today(),categoryId:cat.id,description:'مصروف بيت سارة'});
 Fin.addTx(S,u,{type:'expense',accountId:mine.id,amount:1000,date:Fin.today(),categoryId:cat.id,description:'سر سارة'});
 await DB.flush(S);})()"""); W.wait_for_timeout(2500)
ev(H,"Cloud.sync()"); H.wait_for_timeout(1500)
print('H accounts:', names(H,'accounts')); print('H sees tx:', ev(H,"Fin.visibleTx(App.S,App.user).map(t=>t.description)"))
print('H raw records containing سارة private?:', ev(H,"JSON.stringify(App.S.transactions).includes('سر سارة')||JSON.stringify(App.S.accounts).includes('محفظة سارة')"))
print('H members:', ev(H,"App.S.users.map(u=>u.name+':'+u.role)"), 'W members:', ev(W,"App.S.users.map(u=>u.name+':'+u.role)"))
# ---------- offline edit on W, then back online ----------
ctx2.set_offline(True); W.wait_for_timeout(300)
ev(W,"""(async()=>{const S=App.S,u=App.user; const hh=S.accounts.find(a=>a.visibility==='household'); const cat=S.categories.find(c=>c.kind==='expense');
 Fin.addTx(S,u,{type:'expense',accountId:hh.id,amount:500,date:Fin.today(),categoryId:cat.id,description:'أوفلاين سارة'}); await DB.flush(S);})()"""); W.wait_for_timeout(2000)
print('W offline badge:', W.locator('#cloudbadge').inner_text(), '| pending:', ev(W,"Cloud.status().pending"))
ctx2.set_offline(False); ev(W,"Cloud.sync()"); W.wait_for_timeout(1500); ev(H,"Cloud.sync()"); H.wait_for_timeout(1500)
print('after reconnect W pending:', ev(W,"Cloud.status().pending"), '| H sees offline tx:', ev(H,"Fin.visibleTx(App.S,App.user).some(t=>t.description==='أوفلاين سارة')"))
# ---------- deletion + inline image blob ----------
ev(H,"""(async()=>{const S=App.S,u=App.user; const n=S.notes.find(n=>n.title==='ملاحظة مشتركة');
 const c=document.createElement('canvas');c.width=64;c.height=48;const x=c.getContext('2d');x.fillStyle='#c33';x.fillRect(0,0,64,48);
 const b=await new Promise(r=>c.toBlob(r,'image/png')); const f=new File([b],'p.png',{type:'image/png'});
 const rec=await App.saveAttachment(f,{kind:'note',id:n.id});
 Life.saveNote(S,u,{id:n.id,title:n.title,html:'<p>للبيت</p><div><img data-fid="'+rec.id+'"></div>',visibility:'household',attachments:[rec.id]}); await DB.flush(S);
 const d=Life.saveNote(S,u,{title:'هتتمسح',html:'<p>x</p>',visibility:'household'}); await DB.flush(S); window.__del=d.id;})()"""); H.wait_for_timeout(2500)
ev(W,"Cloud.sync()"); W.wait_for_timeout(1500)
print('W has to-delete note:', ev(W,"App.S.notes.some(n=>n.title==='هتتمسح')"))
ev(H,"(async()=>{Life.deleteNote(App.S,App.user,window.__del); await DB.flush(App.S);})()"); H.wait_for_timeout(2500); ev(W,"Cloud.sync()"); W.wait_for_timeout(1500)
print('after delete, W has it:', ev(W,"App.S.notes.some(n=>n.title==='هتتمسح')"))
img=ev(W,"""(async()=>{const n=App.S.notes.find(n=>n.title==='ملاحظة مشتركة'); const fid=(n.html.match(/data-fid="([^"]+)"/)||[])[1]; const before=!!(await DB.getBlob(fid)); const u=await App.blobURL(fid); const after=!!(await DB.getBlob(fid)); return {fid:!!fid,before,after,url:!!u}})()""")
print('W image blob (before fetch, after fetch):', img)
# ---------- privacy at lock screen + restore guard ----------
print('lock list on W filtered to self only:', ev(W,"Cloud.status().userId===App.user.id"))
r.done()
