import asyncio,json,pathlib,os,urllib.request
from playwright.async_api import async_playwright
LOCAL='http://localhost:8765'
STAGING=os.environ.get('JOBHUB_TEST_STAGING')=='true'
BASE='https://solectrics-jobhub-staging.pages.dev' if STAGING else LOCAL
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  results=[]
  token=json.load(urllib.request.urlopen(LOCAL+'/__synthetic_token'))['token'] if STAGING else None
  async def route_request(route):
   if not route.request.url.startswith(BASE+'/'):return await route.abort()
   if not STAGING:return await route.continue_()
   headers={**route.request.headers,'cf-access-jwt-assertion':token}
   upstream=await route.fetch(url=LOCAL+route.request.url[len(BASE):],headers=headers)
   await route.fulfill(response=upstream)
  for width in [375,390,430,1440]:
   context=await browser.new_context(viewport={'width':width,'height':900},timezone_id='Pacific/Auckland')
   await context.route('**/*',route_request)
   page=await context.new_page();page.set_default_timeout(12000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
   print('Viewport',width,flush=True)
   await page.goto(BASE+'/mini-fergus');await page.wait_for_selector('.job-card');await page.locator('#jh-job-search').fill('Beta');assert await page.locator('.job-card:visible').count()==1
   assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'),'Dashboard overflow'
   await page.goto(BASE+'/mini-fergus-job?id=9101');await page.wait_for_selector('#hecAnswersForm',state='attached');await page.wait_for_function("document.getElementById('handoverForm') && !document.getElementById('handoverForm').hidden")
   if STAGING:await page.wait_for_function("document.getElementById('handoverActor').disabled")
   await page.locator('#hecEditorSection>details').evaluate('(e)=>e.open=true')
   if width==375:
    form=page.locator('#hecAnswersForm');await form.locator('[data-hec-key=people]').select_option('4');await form.locator('[data-hec-key=hotWater]').select_option('Gas');assert not await form.locator('[data-hec-key=cylinderSize]').is_visible()
    await form.locator('[data-hec-key=hotWater]').select_option('Electric hot-water cylinder');await form.locator('[data-hec-key=cylinderSize]').select_option('180–250 litres');await form.locator('[data-reason]').fill('Synthetic mobile occupancy correction');await form.locator('[data-approve]').check();await form.get_by_role('button',name='Save reviewed HEC changes').click();await page.wait_for_timeout(500);print('HEC status',await page.locator('#hecEditorSection [role=status]').text_content(),flush=True);await page.wait_for_function("document.querySelector('#hecEditorSection [role=status]').textContent.startsWith('Saved.')")
    assert '4' in await page.locator('#hecDisplaySection').text_content()
    details=page.locator('#hecManualBillForm').locator('..');await details.evaluate('(e)=>e.open=true');bf=page.locator('#hecManualBillForm');await bf.locator('#hecBillSlot').select_option('winter')
    for key,value in [('billing_days','30'),('total_import_kwh','600'),('total_bill_nzd','180'),('electricity_charges_nzd','180'),('retailer','Example Energy'),('plan_name','Example Plan')]:await bf.locator('[data-hec-key='+key+']').fill(value)
    await bf.locator('[data-hec-key=electricity_cost_separation_status]').select_option('electricity_only');await bf.locator('[data-reason]').fill('Synthetic manual bill after reader unavailable');await bf.locator('[data-approve]').check();await bf.get_by_role('button',name='Save reviewed bill information').click();await page.wait_for_function("document.querySelector('#hecEditorSection [role=status]').textContent.startsWith('Saved.')")
    await page.evaluate("revealDocumentUpload('additional_power_bill')");await page.locator('#jobFileRole').select_option('additional_power_bill');await page.locator('#jobFileInput').set_input_files({'name':'synthetic-added-bill.pdf','mimeType':'application/pdf','buffer':b'%PDF-1.4 Synthetic uploaded bill only'})
    await page.wait_for_function("document.getElementById('jobFilesList').textContent.includes('synthetic-added-bill.pdf')")
    await page.evaluate("WorkspaceNavigation.openSection('energyDataPanel')");button=page.locator('[data-read-energy-bill]:visible').first;await button.click();await page.get_by_role('button',name='Enter bill information manually').wait_for();await page.get_by_role('button',name='Enter bill information manually').click()
    await page.evaluate("WorkspaceNavigation.openSection('handoverAftercare')");
    for key in ['Documents','Operation','Monitoring','Support']:await page.locator('#handover'+key).check()
    await page.locator('#handoverDate').fill('2026-01-31');await page.locator('#handoverForm button[type=submit]').click();await page.wait_for_function("document.getElementById('aftercareFollowups').querySelectorAll('form').length===2")
    await page.locator('#handoverForm button[type=submit]').click();await page.wait_for_function("document.getElementById('handoverMessage').textContent.includes('Handover saved')")
    state=json.load(urllib.request.urlopen(LOCAL+'/__synthetic_state'));assert state['jobs']==2 and state['enquiries']==2;assert len(state['files'])==4;assert state['quotes'][0]['status']=='issued';assert state['answers']['people']=='4';assert state['answers']['bills']['winter']['average_daily_kwh']==20;tasks=[t for t in state['tasks'] if t['task_key'] in ['aftercare-2-week','aftercare-1-month']];assert len(tasks)==2;assert sorted(t['due_date'] for t in tasks)==['2026-02-14','2026-02-28']
   assert not await page.locator('#design_reviewed').is_checked(),'Old design review must not certify changed HEC'
   assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'),'Job page overflow '+str(width)
   await page.goto(BASE+'/mini-fergus-operations');await page.wait_for_function("document.getElementById('pipelineRows').children.length>0");assert await page.locator('#calendar').count()==1;assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'),'Operations overflow'
   await page.goto(BASE+'/mini-fergus-job?id=9102');await page.wait_for_selector('#general_job_description',state='attached');assert await page.locator('#hecEditorSection').count()==0;assert not await page.locator('#handoverAftercare').is_visible()
   if width==1440:
    await page.goto(BASE+'/mini-fergus-job?id=9101');await page.wait_for_selector('#hecAnswersForm',state='attached');await page.locator('#hecEditorSection>details').evaluate('(e)=>e.open=true')
    other=await context.new_page();await other.goto(BASE+'/mini-fergus-job?id=9101');await other.wait_for_selector('#hecAnswersForm',state='attached');await other.locator('#hecEditorSection>details').evaluate('(e)=>e.open=true')
    a=page.locator('#hecAnswersForm');await a.locator('[data-hec-key=meter_number]').fill('SYNTHETIC-METER-1440');await a.locator('[data-reason]').fill('Synthetic desktop edit');await a.locator('[data-approve]').check();await a.get_by_role('button',name='Save reviewed HEC changes').click();await page.wait_for_function("document.querySelector('#hecEditorSection [role=status]').textContent.startsWith('Saved.')")
    b=other.locator('#hecAnswersForm');await b.locator('[data-hec-key=people]').select_option('5+');await b.locator('[data-reason]').fill('Synthetic stale tab');await b.locator('[data-approve]').check();await b.get_by_role('button',name='Save reviewed HEC changes').click();await other.wait_for_function("document.querySelector('#hecEditorSection [role=status]').textContent.includes('changed since')");assert await b.locator('[data-hec-key=people]').input_value()=='5+';await other.close()
   assert not errors,errors
   results.append({'width':width,'dashboard_search':'passed','HEC_manual_bill_upload_aftercare':'passed' if width==375 else 'layout verified','operations_calendar':'passed','general_job_compatibility':'passed','overflow':False,'page_errors':errors});await context.unroute_all(behavior='wait');await context.close()
  await browser.close();print(json.dumps(results,indent=2))
asyncio.run(main())
