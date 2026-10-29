"""Run after server.mjs in a browser-capable environment. Uses fictional data only."""
from pathlib import Path
import json, urllib.request
from playwright.sync_api import sync_playwright
base='http://127.0.0.1:8766'
def post(path):
 return urllib.request.urlopen(urllib.request.Request(base+path,method='POST')).read()
def state():return json.load(urllib.request.urlopen(base+'/__state'))
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 for width,height in [(390,844),(1440,1000)]:
  for action in ['emailResultsButton','sendCheckButton','requestVisitButton']:
   post('/__reset')
   context=browser.new_context(viewport={'width':width,'height':height})
   page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.route('**/*',lambda route:route.continue_() if route.request.url.startswith(base) else route.abort())
   page.goto(base+'/home-energy-check.html')
   # Actual render/handlers and file selection; questionnaire navigation still needs manual review.
   page.evaluate("Object.assign(answers,{name:'Synthetic Acceptance',email:'acceptance@example.invalid',people:'2',homeType:'House',dayHome:'Sometimes',hotWater:'Electric hot-water cylinder',loads:['EV'],goals:['Lower bills']})")
   for season in ['summer','winter']:
    page.locator('#'+season+'Bill').set_input_files(str(Path(__file__).resolve().parents[1]/'fixtures'/'hec-pdfs'/(season+'.pdf')))
    page.evaluate('(season)=>readBill(season)',season)
   page.evaluate('showResult()')
   page.wait_for_selector('#'+action,state='visible')
   assert page.locator('#exploreMore').count()==1
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   if action!='emailResultsButton':page.locator('#privacyConsent').check()
   page.locator('#'+action).click()
   page.wait_for_function("/sent|received|complete/i.test(document.getElementById('sendCheckStatus').textContent)")
   s=state()
   assert s['jobs']==(0 if action=='emailResultsButton' else 1),s
   assert s['emails']==(1 if action=='emailResultsButton' else 0),s
   assert s['files']==(0 if action=='emailResultsButton' else 2),s
   assert not errors,errors
   out=Path('/tmp/hec-acceptance-screenshots');out.mkdir(exist_ok=True)
   page.screenshot(path=str(out/f'{width}-{action}.png'),full_page=True)
   print(width,action,'passed');context.close()
 browser.close()
