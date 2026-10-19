(function(root){
  'use strict';
  const sectionLinks=[['Site Visit','siteVisitSection'],['Design','systemDesignSection'],['Supplier Quotes','supplierPricingSection'],['Costing','internalCostingSection'],['Photos & Documents','jobFilesSection'],['Daily Work','workLogSection'],['Compliance evidence','jobFilesSection']];
  function escape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function openSection(id){const el=document.getElementById(id);if(!el)return false;let parent=el.parentElement;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}el.scrollIntoView({block:'start'});return true;}
  function localJobLink(id){const params=new URLSearchParams(location.search);const jobId=params.get('id')||params.get('job_id');return jobId?`/mini-fergus-job?id=${encodeURIComponent(jobId)}#${id}`:`/mini-fergus?open_section=${id}#jobs-container`;}
  function initNavigation(){
    const nav=document.createElement('nav');nav.className='jh-main-nav';nav.setAttribute('aria-label','Workspace navigation');
    const links=[['Dashboard','/mini-fergus'],['Enquiries & Quotes','/mini-fergus?view=enquiries-quotes#jobs-container'],['Jobs','/mini-fergus#jobs-container'],['Site Visits',localJobLink('siteVisitSection')],['Daily Work & Compliance',localJobLink('workLogSection')],['Materials & Suppliers','/mini-fergus-suppliers'],['Documents',localJobLink('jobFilesSection')],['Invoices & Payments',localJobLink('internalCostingSection')]];
    const title=document.createElement('strong');title.textContent=root.WorkspaceBranding?.productName||'Job Hub';nav.append(title);
    for(const [label,url] of links){const a=document.createElement('a');a.textContent=label;a.href=url;nav.append(a);}const operations=document.createElement('span');operations.className='jh-nav-unavailable';operations.textContent='Operations · separate staging branch';nav.append(operations);document.body.prepend(nav);
    const menu=document.createElement('details');menu.className='jh-mobile-menu';const summary=document.createElement('summary');summary.textContent='MENU';menu.append(summary);const menuLinks=document.createElement('div');for(const a of nav.querySelectorAll('a'))menuLinks.append(a.cloneNode(true));menuLinks.append(operations.cloneNode(true));menu.append(menuLinks);document.body.prepend(menu);
    const bottom=document.createElement('nav');bottom.className='jh-mobile-bottom';bottom.setAttribute('aria-label','Quick workspace navigation');
    for(const [label,url] of [['Home','/mini-fergus'],['Jobs','/mini-fergus#jobs-container'],['Site Visit',localJobLink('siteVisitSection')],['Daily Work',localJobLink('workLogSection')]]){const a=document.createElement('a');a.textContent=label;a.href=url;bottom.append(a);}document.body.append(bottom);
    document.addEventListener('click',event=>{const a=event.target.closest('a[href^="#"]');if(a?.hash)openSection(a.hash.slice(1));});window.addEventListener('hashchange',()=>openSection(location.hash.slice(1)));
  }
  function enhanceJob(){
    const page=document.getElementById('page');if(!page||page.dataset.navigationReady)return;const sections=[...page.children].filter(el=>el.tagName==='SECTION');if(!sections.length||sections[0].classList.contains('error'))return;
    page.dataset.navigationReady='true';const assessment=sections.find(el=>el.querySelector('#assessmentForm')||el.querySelector('h2')?.textContent.trim()==='Assessment & design');
    if(assessment){for(const id of ['siteVisitSection','jobFilesSection']){const el=document.getElementById(id);if(el)page.insertBefore(el,assessment);}}
    const shortcuts=document.createElement('nav');shortcuts.className='jh-job-shortcuts';shortcuts.setAttribute('aria-label','Job sections');page.querySelector('.status')?.after(shortcuts);
    for(const section of [...page.children].filter(el=>el.tagName==='SECTION')){
      const heading=section.querySelector('h2');if(!heading)continue;const title=heading.textContent.trim();if(['Customer','Next action'].includes(title))continue;
      const wrapper=document.createElement('details');wrapper.className='jh-job-section';const summary=document.createElement('summary');summary.textContent=title;wrapper.append(summary);section.before(wrapper);wrapper.append(section);
      const sync=()=>wrapper.hidden=section.hidden;sync();new MutationObserver(sync).observe(section,{attributes:true,attributeFilter:['hidden']});
    }
    for(const [label,id] of sectionLinks){const el=document.getElementById(id);if(!el||el.hidden)continue;const a=document.createElement('a');a.href='#'+id;a.textContent=label;shortcuts.append(a);}
    const documents=document.getElementById('documentSummary');if(documents){const summary=document.createElement('div');summary.className='jh-job-document-summary';summary.setAttribute('aria-live','polite');shortcuts.after(summary);const update=()=>{summary.textContent='Documents: '+(documents.textContent.trim()||'Checking attachment status…');};update();new MutationObserver(update).observe(documents,{childList:true,subtree:true,characterData:true});}
    openSection(location.hash.slice(1));
  }
  function filteredJobs(jobs,query='',kind='all',status='all'){
    const q=query.toLowerCase().trim();return jobs.filter(job=>(kind==='all'||job.job_type===kind)&&(status==='all'||job.job_status===status)&&(!q||[job.customer_name,job.address,job.enquiry_ref,job.job_id].some(value=>String(value??'').toLowerCase().includes(q))));
  }
  function renderDashboard(jobs){
    const panel=document.getElementById('jh-dashboard');if(!panel)return;
    const completed=jobs.filter(j=>j.job_status==='completed').length,enquiries=jobs.filter(j=>j.job_status==='enquiry').length;
    panel.innerHTML=`<h2>Jobs overview</h2><div class="jh-overview-grid"><div><span>Linked new enquiries</span><strong>${enquiries}</strong><small>Jobs with enquiry status</small></div><div><span>Quotes to prepare</span><strong>—</strong><small>Check saved next actions below</small></div><div><span>Awaiting customer approval</span><strong>—</strong><small>Check quote versions in the job</small></div><div><span>Ready to install</span><strong>—</strong><small>Operations readiness is not available on this branch</small></div><div><span>Installations in progress</span><strong>—</strong><small>Installation state not supplied by this Jobs list</small></div><div><span>Completed jobs</span><strong>${completed}</strong><small>Job status; not financial completion</small></div></div>`;
    const queue=document.getElementById('jh-next-actions');queue.innerHTML='<h2>Recorded next actions</h2>';
    const items=jobs.filter(job=>job.job_status!=='completed'&&job.next_action?.trim()).slice(0,8);
    if(!items.length)queue.append(Object.assign(document.createElement('p'),{textContent:'No saved next actions in the active Jobs list.'}));
    for(const job of items){const a=document.createElement('a');a.className='jh-action-row';a.href=`/mini-fergus-job?id=${encodeURIComponent(job.job_id)}`;const name=document.createElement('strong');name.textContent=job.customer_name||'Job '+job.job_id;const text=document.createElement('span');text.textContent=job.next_action;a.append(name,text);queue.append(a);}
    queue.append(Object.assign(document.createElement('p'),{className:'jh-note',textContent:'Saved next actions only. This view does not infer blockers, overdue tasks, supplier delays or unpaid invoices.'}));
  }
  function enhanceHome(){
    const container=document.getElementById('jobs-container');if(!container)return;
    const controls=document.createElement('section');controls.className='jh-job-filters';controls.innerHTML='<label>Find a job<input id="jh-job-search" type="search" placeholder="Customer, address or reference"></label><label>Job type<select id="jh-job-type"><option value="all">All job types</option><option value="solar">Solar</option><option value="general_electrical">General electrical</option></select></label><label>Status<select id="jh-job-status"><option value="all">All statuses</option></select></label><span id="jh-results" aria-live="polite"></span>';
    container.before(controls);
    const params=new URLSearchParams(location.search);const section=params.get('open_section');if(section||params.has('view')){const note=document.createElement('p');note.className='jh-note';note.textContent=section?'Choose a job below to open '+(sectionLinks.find(x=>x[1]===section)?.[0]||'the requested section')+'.':'Enquiries and quotes stay linked to their jobs. Open a job to review its HEC, quote versions and customer acceptance.';controls.before(note);}
    const apply=()=>{const jobs=root.jobHubJobsForNavigation||[],matches=filteredJobs(jobs,document.getElementById('jh-job-search').value,document.getElementById('jh-job-type').value,document.getElementById('jh-job-status').value);const ids=new Set(matches.map(j=>String(j.job_id)));container.querySelectorAll('.job-card').forEach(card=>{const a=card.querySelector('a.open-job');if(!a)return;const id=new URL(a.href,location.href).searchParams.get('id');card.hidden=!ids.has(id);if(section)a.href=`/mini-fergus-job?id=${encodeURIComponent(id)}#${encodeURIComponent(section)}`;});document.getElementById('jh-results').textContent=`${matches.length} of ${jobs.length} jobs`;};
    for(const id of ['jh-job-search','jh-job-type','jh-job-status'])document.getElementById(id).addEventListener('input',apply);
    const refresh=()=>{const jobs=root.jobHubJobsForNavigation;if(!Array.isArray(jobs))return;renderDashboard(jobs);const status=document.getElementById('jh-job-status'),selected=status.value;status.replaceChildren(new Option('All statuses','all'));for(const value of [...new Set(jobs.map(j=>j.job_status).filter(Boolean))].sort())status.add(new Option(value.replaceAll('_',' '),value));status.value=[...status.options].some(o=>o.value===selected)?selected:'all';apply();};document.addEventListener('workspace:jobs-loaded',refresh);refresh();
  }
  root.WorkspaceNavigation={openSection,enhanceJob,filteredJobs};
  function init(){initNavigation();enhanceHome();enhanceJob();}
  if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();}
})(globalThis);
