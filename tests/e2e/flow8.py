import sys, json; sys.path.insert(0,'/tmp/e2e')
from lib import Run
r=Run(); pg=r.pg
calls=[]
def spot(route):
    calls.append(route.request.url)
    route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin':'*'}, body=json.dumps({"xau":{"price":5000.0,"currency":"EGP","unit":"gram"},"per_gram_usd":100.0,"spot_usd_oz":3110.35,"fx_rate":50.0}))
pg.route('**/xaus.com/api/v1/spot*', spot)
r.open(); r.onboard(); pg.wait_for_timeout(1500)
print('fetch calls:', len(calls), 'rates:', r.ev("App.S.rates.map(x=>x.currency+'='+x.rate)"), 'meta src:', r.ev("App.ratesMeta()&&App.ratesMeta().src"))
print('persisted flag:', r.ev("App.get('persisted')"))
# gold account (10 g of 21K) + savings account with 50,000
pg.locator('nav.bottom button').nth(1).click(); pg.wait_for_timeout(300)
pg.locator('.qa button', has_text='+ ذهب').first.click(); pg.wait_for_selector('.sheet')
print('gold sheet currency options:', pg.locator('.sheet select').nth(1).locator('option').all_inner_texts())
pg.locator('.sheet input[type=text]').first.fill('دبل ذهب'); pg.locator('.sheet input[inputmode=decimal]').first.fill('10')
pg.locator('.sheet .btns .btn.primary').click(); pg.wait_for_timeout(500)
pg.locator('.qa button', has_text='+ ادخار').first.click(); pg.wait_for_selector('.sheet')
pg.locator('.sheet input[type=text]').first.fill('صندوق'); pg.locator('.sheet input[inputmode=decimal]').first.fill('50000')
pg.locator('.sheet .btns .btn.primary').click(); pg.wait_for_timeout(500)
row=pg.locator('.row', has_text='دبل ذهب'); print('gold row:', row.inner_text().replace('\n',' | '))
print('personal total (all):', pg.locator('.stat.hero b').inner_text())
pg.screenshot(path='/tmp/e2e/gold_accounts.png', full_page=True)
# exclude savings + gold from total
pg.locator('.stat.hero').click(); pg.wait_for_selector('.sheet'); pg.locator('.sheet .chip', has_text='استبعاد الادخار').click(); pg.locator('.sheet .btns .btn.primary').click(); pg.wait_for_timeout(500)
print('total w/o savings:', pg.locator('.stat.hero b').inner_text(), '| savings row:', pg.locator('.row', has_text='صندوق').inner_text().replace('\n',' | '))
pg.locator('.stat.hero').click(); pg.wait_for_selector('.sheet'); pg.locator('.sheet .chip', has_text='الكل').click(); pg.locator('.sheet .btns .btn.primary').click(); pg.wait_for_timeout(300)
print('total back to all:', pg.locator('.stat.hero b').inner_text())
# rates sheet
pg.locator('.btn', has_text='أسعار الصرف').click(); pg.wait_for_selector('.sheet'); pg.screenshot(path='/tmp/e2e/rates_sheet.png'); print('rates sheet rows:', pg.locator('.sheet .row').all_inner_texts())
# premium 10% then update now
pg.locator('.sheet input[inputmode=decimal]').first.fill('10'); pg.locator('.sheet .btn', has_text='تحديث الآن').click(); pg.wait_for_timeout(1200)
print('G21 after +10% premium:', r.ev("Fin.rateFor(App.S,'G21')"), '(expected', 5000*1.1*21/24, ')  USD:', r.ev("Fin.rateFor(App.S,'USD')"), ' rate records:', r.ev("App.S.rates.length"))
# value check: 10 g * rate
print('gold row now:', pg.locator('.row', has_text='دبل ذهب').inner_text().replace('\n',' | '))
# home + failure path
r.ev("App.go('home')"); pg.wait_for_timeout(300); pg.screenshot(path='/tmp/e2e/home_gold.png', full_page=True)
pg.unroute('**/xaus.com/api/v1/spot*'); pg.route('**/xaus.com/**', lambda rt: rt.abort()); pg.route('**/open.er-api.com/**', lambda rt: rt.abort())
print('refresh with network failure ->', r.ev("App.refreshRates(true)"), '| rate unchanged:', r.ev("Fin.rateFor(App.S,'G21')"))
# backup reminder
r.ev("App.set('lastBackup', new Date(Date.now()-9*864e5).toISOString())"); r.ev("App.refreshNotifs()"); pg.wait_for_timeout(500)
print('backup notif:', r.ev("App.S.notifs.filter(n=>n.type==='backup').map(n=>App.notifText(n))"))
r.done()
