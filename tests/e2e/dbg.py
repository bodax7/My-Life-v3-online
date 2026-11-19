import sys, json; sys.path.insert(0,'/tmp/e2e')
from lib import Run
r=Run(); pg=r.pg; calls=[]
pg.route('**/xaus.com/api/v1/spot*', lambda rt:(calls.append(1), rt.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin':'*'}, body=json.dumps({"xau":{"price":5000.0,"currency":"EGP","unit":"gram"},"per_gram_usd":100.0}))))
r.open(); r.onboard(); pg.wait_for_timeout(800)
print('online', r.ev("navigator.onLine"), 'user', r.ev("!!App.user"), 'meta', r.ev("App.ratesMeta()"))
print(r.ev("App.refreshRates(true)"), len(calls), r.ev("App.S.rates.length"))
print(r.errs[-5:])
