// -
// DB
// -
const DB={
  get:(k,def)=>{try{const v=localStorage.getItem('tl_'+k);return v?JSON.parse(v):def;}catch{return def;}},
  set:(k,v)=>{try{localStorage.setItem('tl_'+k,JSON.stringify(v));}catch(e){}}
};

// - STATE
let calYear=new Date().getFullYear(),calMonth=new Date().getMonth(),_weekOffset=0;
let _tdTrade=null,_tdTradeList=[],_tdIdx=0;
let currentTradeImages=[],currentImgModalImages=[],currentImgModalIdx=0;
let liveRate=null,convDir='usd-inr',bulkRows=[];
let selectedPsych='',selectedEQ=[];
let conflItems=['HTF Trend Aligned','Key Level Reaction','FVG Present','Session Killzone','Liquidity Swept','MSS / BOS Confirmed','Volume Confirmation','Clean Pattern'];
let charts={};
let _tvInterval='60',_tvChartType='1';

function destroyChart(k){if(charts[k]){try{charts[k].destroy();}catch(e){}delete charts[k];}}
function todayStr(){return new Date().toISOString().split('T')[0];}

// - CHART OPTIONS HELPER
const chartOpts=(yFmt)=>({
  responsive:true,maintainAspectRatio:false,
  plugins:{legend:{display:false}},
  scales:{
    x:{ticks:{color:'#555555',font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}},
    y:{ticks:{color:'#555555',callback:yFmt||((v)=>v)},grid:{color:'rgba(255,255,255,0.04)'}}
  }
});

// -
// INIT
// -

// ═══════════════════════════════════════════════════
// ACCOUNTS + PORTFOLIO
// ═══════════════════════════════════════════════════
function ensureAccounts(){
  let accounts=DB.get('accounts',null);
  if(!Array.isArray(accounts)) accounts=[];
  if(!accounts.length){
    const prop=DB.get('prop_config',null);
    const size=prop&&prop.account?Number(prop.account):0;
    accounts=[{id:'acct-main',name:'Main Account',size:size||0,currency:'USD',broker:prop?.name||'',notes:'Migrated from existing TradeLedger data',createdAt:new Date().toISOString()}];
    DB.set('accounts',accounts);
  }
  const ids=new Set(accounts.map(a=>a.id));
  let changed=false;
  const trades=DB.get('trades',[]);
  trades.forEach(t=>{if(!t.accountId||!ids.has(t.accountId)){t.accountId=accounts[0].id;changed=true;}});
  if(changed)DB.set('trades',trades);
  if(!DB.get('active_account',null))DB.set('active_account','all');
  return accounts;
}
function getAccounts(){return ensureAccounts();}
function getActiveAccount(){const v=DB.get('active_account','all');return v||'all';}
function setActiveAccount(id){DB.set('active_account',id||'all');syncAccountSelectors();}
function accountTrades(id='all'){
  const trades=DB.get('trades',[]);
  return id==='all'?trades:trades.filter(t=>t.accountId===id);
}
function accountStats(id='all'){
  const accounts=getAccounts();
  const trades=accountTrades(id);
  const pnl=trades.reduce((s,t)=>s+(Number(t.pnl)||0),0);
  const wins=trades.filter(t=>t.outcome==='Win').length, losses=trades.filter(t=>t.outcome==='Loss').length;
  const base=id==='all'?accounts.reduce((s,a)=>s+(Number(a.size)||0),0):(accounts.find(a=>a.id===id)?.size||0);
  const wr=trades.length?wins/trades.length*100:0;
  const ret=base?pnl/base*100:0;
  return {trades,pnl,base,ret,wins,losses,wr,dd:getMaxDrawdown(trades)};
}
function accountName(id){
  const a=getAccounts().find(x=>x.id===id); return a?a.name:'Unassigned';
}
function accountOptions(selected=''){
  const accounts=getAccounts();
  return accounts.map(a=>`<option value="${a.id}" ${a.id===selected?'selected':''}>${a.name} · $${Number(a.size||0).toLocaleString()}</option>`).join('');
}
function syncAccountSelectors(){
  const accounts=getAccounts(), active=getActiveAccount();
  const dash=document.getElementById('dashboard-account-filter');
  if(dash){dash.innerHTML='<option value="all">All Accounts · Combined</option>'+accounts.map(a=>`<option value="${a.id}">${a.name} · $${Number(a.size||0).toLocaleString()}</option>`).join('');dash.value=active;}
  const trade=document.getElementById('trade-account');
  if(trade){const current=trade.value|| (active!=='all'?active:accounts[0]?.id);trade.innerHTML=accountOptions(current);trade.value=current||'';}
  const sim=document.getElementById('sim-account');
  if(sim){const current=sim.value|| (active!=='all'?active:accounts[0]?.id);sim.innerHTML=accountOptions(current);sim.value=current||'';}
}
function openAccountModal(){
  ['acc-name','acc-size','acc-broker','acc-notes'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  document.getElementById('acc-currency').value='USD';
  openModal('account-modal');
}
function saveAccount(){
  const name=document.getElementById('acc-name').value.trim(), size=Number(document.getElementById('acc-size').value)||0;
  if(!name||size<=0){toast('Enter account name and starting balance','error');return;}
  const accounts=getAccounts();
  const id='acct-'+Date.now();
  accounts.push({id,name,size,currency:document.getElementById('acc-currency').value,broker:document.getElementById('acc-broker').value.trim(),notes:document.getElementById('acc-notes').value.trim(),createdAt:new Date().toISOString()});
  DB.set('accounts',accounts);DB.set('active_account',id);closeModal('account-modal');syncAccountSelectors();renderAccounts();renderDashboard();toast('Account created','ok');
}
function deleteAccount(id){
  const accounts=getAccounts(); if(accounts.length<=1){toast('Keep at least one account','error');return;}
  const name=accountName(id); if(!confirm(`Delete ${name}? Trades will move to the first remaining account.`))return;
  const target=accounts.find(a=>a.id!==id).id;
  const trades=DB.get('trades',[]);trades.forEach(t=>{if(t.accountId===id)t.accountId=target;});
  DB.set('trades',trades);DB.set('accounts',accounts.filter(a=>a.id!==id));
  if(getActiveAccount()===id)DB.set('active_account','all');
  syncAccountSelectors();renderAccounts();renderDashboard();renderTradeLog();toast('Account removed','ok');
}
function renderAccounts(){
  const accounts=getAccounts(), stats=accountStats('all');
  const sum=document.getElementById('accounts-summary');
  if(sum)sum.innerHTML=`<div class="g4"><div><div class="metric-label">Starting Capital</div><div class="metric-value">$${Math.round(stats.base).toLocaleString()}</div></div><div><div class="metric-label">Total Return</div><div class="metric-value" style="color:${stats.pnl>=0?'var(--green)':'var(--red)'};">${stats.pnl>=0?'+':''}$${Math.round(stats.pnl).toLocaleString()}</div></div><div><div class="metric-label">Portfolio ROI</div><div class="metric-value" style="color:${stats.ret>=0?'var(--green)':'var(--red)'};">${stats.ret.toFixed(2)}%</div></div><div><div class="metric-label">Trades</div><div class="metric-value">${stats.trades.length}</div></div></div>`;
  const grid=document.getElementById('accounts-grid');if(!grid)return;
  grid.innerHTML=accounts.map(a=>{
    const s=accountStats(a.id),color=s.pnl>=0?'var(--green)':'var(--red)';
    return `<div class="card" style="position:relative;">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;"><div><div class="t-label">${a.broker||'Trading Account'}</div><div class="t-h2" style="margin-top:4px;">${a.name}</div></div><span class="tag ${s.pnl>=0?'tag-win':'tag-loss'}">${s.ret.toFixed(2)}% ROI</span></div>
      <div class="g2" style="margin-top:18px;"><div><div class="metric-label">Account Size</div><div class="metric-value">$${Number(a.size||0).toLocaleString()}</div></div><div><div class="metric-label">Return</div><div class="metric-value" style="color:${color};">${s.pnl>=0?'+':''}$${Math.round(s.pnl).toLocaleString()}</div></div></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid var(--border-subtle);font-size:11px;color:var(--text-muted);"><span>${s.trades.length} trades</span><span>${s.wr.toFixed(1)}% WR</span><span>DD $${Math.abs(Math.round(s.dd)).toLocaleString()}</span></div>
      <div style="display:flex;gap:8px;margin-top:14px;"><button class="btn btn-primary btn-sm" onclick="setActiveAccount('${a.id}');renderDashboard();showPage('dashboard',document.querySelector('.nav-item'))">Use Account</button><button class="btn btn-ghost btn-sm" onclick="deleteAccount('${a.id}')">Delete</button></div>
    </div>`;
  }).join('');
}


function init(){
  ensureAccounts();
  if(!DB.get('checklist',null))DB.set('checklist',[
    {id:1,cat:'Mindset',text:"Reviewed yesterday's trades and lessons",done:false},
    {id:2,cat:'Market',text:'Checked pre-market levels & global markets',done:false},
    {id:3,cat:'Setup',text:'Identified key support & resistance / liquidity levels',done:false},
    {id:4,cat:'Risk',text:'Set max loss limit for the day',done:false},
    {id:5,cat:'Setup',text:'Identified 2-3 high-probability setups to watch',done:false},
    {id:6,cat:'Mindset',text:'Meditation / breathing exercise done',done:false},
    {id:7,cat:'Risk',text:'Position size calculated for each trade',done:false},
  ]);
  if(!DB.get('rules',null))DB.set('rules',[
    'Only trade in trend direction on 15m chart',
    'Do not trade first 15 minutes of session open',
    'Max 3 trades per day — quality over quantity',
    'Never move SL against your position',
    'Risk only 1% per trade, never more than 2% per day',
  ]);
  const ci=DB.get('confl_items',null); if(ci)conflItems=ci;
  document.getElementById('trade-date').value=todayStr();
  syncAccountSelectors();
  document.getElementById('prep-today-label').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  document.getElementById('topbar-sub').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const k=getGroqKey();
  const mk=getMarketKey();
  const mkEl=document.getElementById('settings-market-key'); if(mkEl)mkEl.value=mk;
  if(mk && document.getElementById('page-simulator')?.classList.contains('active')) connectLiveMarket();
  if(k){
    document.getElementById('nav-groq-dot').classList.add('on');
    document.getElementById('nav-groq-label').textContent='Groq Active';
    document.getElementById('sb-groq-pill').classList.add('connected');
    document.getElementById('settings-groq-key').value=k;
  }
  loadPrepNotes();renderChecklist();renderStrategyRules();renderTradeLog();
  renderSettings();renderConflGrid();renderConflSettings();renderPsychGrid();renderEQGrid();
  renderPropFirm();renderAccounts();renderSimulator();updateAIKPIs();initWeekLabel();
  renderDashboard();loadChart();
}

// -
// TOAST
// -
function toast(msg,type){
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.style.borderLeftColor=type==='error'?'var(--red)':type==='ok'?'var(--green)':'var(--accent)';
  t.style.display='block';
  setTimeout(()=>{t.style.display='none';},2800);
}

// -
// SIDEBAR & NAVIGATION
// -
let _sidebarOpen=false;
function toggleSidebar(){
  _sidebarOpen=!_sidebarOpen;
  document.getElementById('sidebar').classList.toggle('open',_sidebarOpen);
}
function openMobileNav(){
  document.getElementById('sidebar').classList.add('mobile-open');
  document.getElementById('sb-overlay').classList.add('show');
}
function closeMobileNav(){
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sb-overlay').classList.remove('show');
}

const pageTitles={dashboard:'Dashboard',chart:'Chart Panel',checklist:'Pre-Trade',journal:'Log Trade',calendar:'Calendar',analytics:'Analytics',review:'Weekly Review',prop:'Prop Firm',accounts:'Accounts',simulator:'Paper Simulator',converter:'$ ⇄ ₹',settings:'Settings'};

function showPage(name,el){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pg=document.getElementById('page-'+name);
  if(pg)pg.classList.add('active');
  if(el)el.classList.add('active');
  document.getElementById('topbar-title').textContent=pageTitles[name]||name;
  closeMobileNav();
  if(name==='analytics')renderAnalytics();
  if(name==='review')renderWeekendReview();
  if(name==='calendar')renderCalendar();
  if(name==='settings')renderSettings();
  if(name==='prop')renderPropFirm();
  if(name==='accounts')renderAccounts();
  if(name==='simulator')renderSimulator();
  if(name==='converter'){fetchLiveRate();setDir('usd-inr');}
  if(name==='dashboard')renderDashboard();
  if(name==='chart')loadChart();
  if(name==='simulator'){loadSimTradingView(); connectLiveMarket(); fetchLivePaperQuote();}
}

// -
// MODALS
// -
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.querySelectorAll('.modal-overlay').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('open');}));

// -
// DASHBOARD
// -
function renderDashboard(){
  syncAccountSelectors();
  const active=getActiveAccount();
  const trades=accountTrades(active);
  const wins=trades.filter(t=>t.outcome==='Win'),losses=trades.filter(t=>t.outcome==='Loss');
  const totalPnl=trades.reduce((s,t)=>s+(t.pnl||0),0);
  const avgWin=wins.length?wins.reduce((s,t)=>s+(t.pnl||0),0)/wins.length:0;
  const avgLoss=losses.length?Math.abs(losses.reduce((s,t)=>s+(t.pnl||0),0)/losses.length):0;
  const wr=trades.length?(wins.length/trades.length*100).toFixed(1):0;
  const base=getActiveAccount()==='all'?getAccounts().reduce((s,a)=>s+(Number(a.size)||0),0):(getAccounts().find(a=>a.id===getActiveAccount())?.size||0);
  const roi=base?((totalPnl/base)*100).toFixed(2):'0.00';
  const rr=avgLoss?(avgWin/avgLoss).toFixed(2):0;
  const exp=trades.length?((wins.length/trades.length*avgWin)-(losses.length/trades.length*avgLoss)).toFixed(2):0;
  const maxDD=getMaxDrawdown(trades);

  // Equity hero
  const pnlEl=document.getElementById('dash-pnl');
  if(pnlEl){pnlEl.textContent=`${totalPnl>=0?'+':''}$${Math.abs(Math.round(totalPnl)).toLocaleString()}`;pnlEl.className='dash-equity-pnl '+(totalPnl>=0?'pos':'neg');}
  const pctEl=document.getElementById('dash-pnl-pct');
  if(pctEl)pctEl.textContent=trades.length?`${roi}% ROI`:'No trades yet';
  const badgeEl=document.getElementById('dash-pnl-badge');
  if(badgeEl)badgeEl.textContent=`${trades.length} trade${trades.length!==1?'s':''}`;
  const ddEl=document.getElementById('dash-dd');
  if(ddEl)ddEl.textContent=`$${Math.abs(Math.round(maxDD)).toLocaleString()}`;

  // KPIs
  const s=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  s('dk-wr',`${wr}%`);s('dk-wrs',`${wins.length}W · ${losses.length}L`);
  s('dk-aw',`$${Math.round(avgWin).toLocaleString()}`);s('dk-al',`$${Math.round(avgLoss).toLocaleString()}`);
  s('dk-rr',rr+'R');s('dk-exp',`${exp>=0?'+':''}$${exp}`);
  s('ka-aw',`$${Math.round(avgWin).toLocaleString()}`);s('ka-wr',`${wr}%`);
  s('ka-am',trades.length?`${Math.round((trades.length-wins.length)/trades.length*100)}%`:'—');
  s('ka-rr',rr+'R');

  // Ka bars (session)
  const sessions={Asian:{pnl:0,c:0},'London Open':{pnl:0,c:0},'NY Open':{pnl:0,c:0},'London Close':{pnl:0,c:0}};
  trades.filter(t=>sessions[t.session]).forEach(t=>{sessions[t.session].pnl+=(t.pnl||0);sessions[t.session].c++;});
  const maxSP=Math.max(...Object.values(sessions).map(s=>Math.abs(s.pnl)),1);
  const kaBars=document.getElementById('ka-bars');
  if(kaBars)kaBars.innerHTML=Object.entries(sessions).map(([n,d])=>`
    <div class="ka-bar-row">
      <div class="ka-bar-label">${n.replace(' Open','').slice(0,4)}</div>
      <div class="ka-bar-track"><div class="ka-bar-fill" style="width:${(Math.abs(d.pnl)/maxSP*100).toFixed(0)}%;background:${d.pnl>=0?'var(--green)':'var(--red)'}"></div></div>
      <div style="font-family:var(--font-jet);font-size:10px;color:${d.pnl>=0?'var(--green)':'var(--red)'};width:56px;text-align:right;">${d.pnl>=0?'+':''}$${Math.round(d.pnl).toLocaleString()}</div>
    </div>`).join('');

  // Equity chart
  const sorted=[...trades].sort((a,b)=>a.date.localeCompare(b.date));
  let cum=0;const cumData=sorted.map(t=>{cum+=(t.pnl||0);return parseFloat(cum.toFixed(2));});
  destroyChart('dashEquity');
  const ec=document.getElementById('dash-equity-chart');
  if(ec&&cumData.length)charts.dashEquity=new Chart(ec,{
    type:'line',
    data:{labels:sorted.map(t=>t.date.slice(5)),datasets:[{data:cumData,borderColor:'#ffffff',backgroundColor:'rgba(255,255,255,0.05)',fill:true,tension:0.4,pointRadius:0,borderWidth:2}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{display:false},y:{display:false}}}
  });

  // AI coaching panel
  const noMistakePct=trades.length?trades.filter(t=>!t.mistake).length/trades.length:0;
  const ruleFollowPct=trades.length?trades.filter(t=>t.ruleAdhere==='Followed All Rules'||t.ruleAdhere==='Mostly Followed').length/trades.length:0;
  const discScore=trades.length?Math.round(noMistakePct*50+ruleFollowPct*30+(wins.length/(trades.length||1))*20):0;
  s('dash-disc-score',trades.length?discScore:'—');
  s('dash-disc-grade',trades.length?(discScore/10).toFixed(1):'—');
  const mistakes=trades.filter(t=>t.mistake).map(t=>t.mistake);
  const topMistake=mistakes.length?Object.entries(mistakes.reduce((a,m)=>{a[m]=(a[m]||0)+1;return a;},{})).sort((a,b)=>b[1]-a[1])[0][0]:null;
  s('dash-ai-pattern',topMistake?`Repeated: ${topMistake}`:trades.length?'No recurring mistakes detected':'Log trades to detect patterns');
  s('dash-ai-note',trades.length?`Discipline score: ${discScore}/100 · Win rate: ${wr}% · Best session: ${Object.entries(sessions).sort((a,b)=>b[1].pnl-a[1].pnl)[0]?.[0]||'N/A'}`:'Connect Groq and log trades for personalised AI coaching insights.');

  // Session heatmap
  renderSessionHeatmap(trades);

  // Recent trades preview
  const recent=trades.slice().reverse().slice(0,7);
  const rb=document.getElementById('dash-recent-trades');
  if(rb)rb.innerHTML=recent.map(t=>`
    <tr class="tr-click" onclick="openTD(${t.id})">
      <td style="color:var(--cyan);font-size:10px;">${accountName(t.accountId)}</td><td style="color:var(--text-muted);font-family:var(--font-jet);font-size:11px;">${t.date}</td>
      <td style="font-weight:600;">${t.symbol}</td>
      <td style="color:var(--text-secondary);">${t.setup||'—'}</td>
      <td style="color:${t.dir==='Long'?'var(--green)':'var(--red)'};font-size:11px;">${t.dir}</td>
      <td style="font-family:var(--font-jet);font-weight:700;color:${(t.pnl||0)>=0?'var(--green)':'var(--red)'};">${(t.pnl||0)>=0?'+':''}$${(t.pnl||0).toLocaleString()}</td>
      <td><span class="tag ${t.outcome==='Win'?'tag-win':t.outcome==='Loss'?'tag-loss':'tag-be'}">${t.outcome}</span></td>
      <td>${(t.images||[]).length?'<span style="font-size:12px;color:var(--accent);">📸</span>':''}</td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px;">No trades yet — log your first trade</td></tr>';

  // Trade review panel — latest trade
  if(trades.length){
    const latest=trades[trades.length-1];
    updateTRP(latest);
  }
}

function updateTRP(t){
  if(!t)return;
  const s=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v||'—';};
  s('trp-sym',`${t.symbol} ${t.dir} (${t.date})`);
  const score=t.grade?{A:95,B:80,C:65,D:45,F:20}[t.grade]||'—':'—';
  s('trp-score',score);s('trp-grade',t.grade||'—');
  const pnlEl=document.getElementById('trp-pnl');
  if(pnlEl){pnlEl.textContent=`${(t.pnl||0)>=0?'+':''}$${(t.pnl||0).toLocaleString()}`;pnlEl.style.color=(t.pnl||0)>=0?'var(--green)':'var(--red)';}
  s('trp-setup',t.setup||'No setup tagged');
  const imgs=t.images||(t.image?[{data:t.image}]:[]);
  const ph=document.getElementById('trp-placeholder');
  const img=document.getElementById('trp-img');
  if(imgs.length&&ph&&img){ph.style.display='none';img.src=imgs[0].data||imgs[0];img.style.display='block';currentImgModalImages=imgs.map(x=>x.data||x);}
  else{if(ph)ph.style.display='flex';if(img)img.style.display='none';}
  if(t.aiAnalysis){const b=document.getElementById('trp-ai-box');const n=document.getElementById('trp-ai-note');if(b)b.style.display='block';if(n)n.textContent=t.aiAnalysis.slice(0,120)+'...';}
  const tagsEl=document.getElementById('trp-tags');
  if(tagsEl){let h=`<span class="tag ${t.outcome==='Win'?'tag-win':t.outcome==='Loss'?'tag-loss':'tag-be'}">${t.outcome}</span>`;if(t.session)h+=`<span class="badge badge-blue">${t.session}</span>`;tagsEl.innerHTML=h;}
  document.getElementById('trp-ai-btn').onclick=()=>{_tdTrade=t;analyseThisTrade();};
}

function openDashImgModal(){openImgModalWithIdx(0);}

async function dashAnalyseTrade(){
  const trades=DB.get('trades',[]);
  if(!trades.length){toast('No trades to analyse','error');return;}
  _tdTrade=trades[trades.length-1];
  analyseThisTrade();
}

function renderSessionHeatmap(trades){
  const el=document.getElementById('session-heatmap');if(!el)return;
  const sessions=['Asian','London Open','NY Open','London Close','NY PM'];
  const wdNums=[1,2,3,4,5];
  const wdNames=['','Mon','Tue','Wed','Thu','Fri'];
  const map={};
  trades.forEach(t=>{const wd=new Date(t.date).getDay();const k=`${wd}_${t.session||''}`;if(!map[k])map[k]=0;map[k]+=(t.pnl||0);});
  const maxAbs=Math.max(...Object.values(map).map(v=>Math.abs(v)),1);
  el.innerHTML=sessions.map(sess=>`
    <div class="sp-row">
      <div class="sp-row-lbl">${sess.replace(' Open','').replace(' Close','').slice(0,3)}</div>
      ${wdNums.map(wd=>{
        const pnl=map[`${wd}_${sess}`]||0;
        const int=Math.abs(pnl)/maxAbs;
        const cls=pnl===0?'sp-0':pnl>0?(int>.66?'sp-p3':int>.33?'sp-p2':'sp-p1'):(int>.66?'sp-n3':int>.33?'sp-n2':'sp-n1');
        return `<div class="sp-cell ${cls}" title="${wdNames[wd]} ${sess}: ${pnl>=0?'+':''}$${Math.round(pnl)}"></div>`;
      }).join('')}
    </div>`).join('');
}

// -
// CHART PANEL (TradingView)
// -
function loadChart(){
  const sym=document.getElementById('tv-symbol')?.value||'NASDAQ:NVDA';
  const url=`https://s.tradingview.com/widgetembed/?frameElementId=tv-frame&symbol=${encodeURIComponent(sym)}&interval=${_tvInterval}&hidesidetoolbar=0&hidetoptoolbar=0&symboledit=1&saveimage=1&toolbarbg=0f1520&studies=[]&theme=dark&style=${_tvChartType}&timezone=exchange&withdateranges=1&showpopupbutton=1&allow_symbol_change=1&calendar=0&hotlist=0&news=0&locale=en`;
  const iframe=document.getElementById('tv-iframe');
  if(iframe)iframe.src=url;
  document.querySelectorAll('.tb-btn').forEach(b=>{if(b.textContent.includes(_tvInterval)||b.textContent===({1:'1m',5:'5m',15:'15m',60:'1H',240:'4H','D':'1D'}[_tvInterval]))b.classList.add('active');else b.classList.remove('active');});
}
function setInterval2(v){_tvInterval=v;loadChart();}
function setChartType(v){_tvChartType=v;loadChart();}

// -
// CHECKLIST
// -
function renderChecklist(){
  const items=DB.get('checklist',[]);
  const done=items.filter(i=>i.done).length;
  document.getElementById('checklist-progress-label').textContent=`${done}/${items.length}`;
  document.getElementById('checklist-bar').style.width=items.length?`${done/items.length*100}%`:'0%';
  document.getElementById('checklist-items').innerHTML=items.map(item=>`
    <div class="check-item">
      <div class="check-box ${item.done?'checked':''}" onclick="toggleCheck(${item.id})"></div>
      <div style="flex:1;"><div class="check-cat">${item.cat}</div><div class="${item.done?'check-done':''}">${item.text}</div></div>
      <button onclick="removeCheck(${item.id})" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;transition:color var(--dur-fast);" onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--text-muted)'">×</button>
    </div>`).join('');
}
function toggleCheck(id){const items=DB.get('checklist',[]);const it=items.find(i=>i.id===id);if(it)it.done=!it.done;DB.set('checklist',items);renderChecklist();}
function removeCheck(id){DB.set('checklist',DB.get('checklist',[]).filter(i=>i.id!==id));renderChecklist();}
function resetChecklist(){DB.set('checklist',DB.get('checklist',[]).map(i=>({...i,done:false})));renderChecklist();toast('Checklist reset');}
function addChecklistItem(){
  const cat=document.getElementById('new-check-cat').value.trim();
  const text=document.getElementById('new-check-text').value.trim();
  if(!text)return;
  const items=DB.get('checklist',[]);items.push({id:Date.now(),cat:cat||'General',text,done:false});DB.set('checklist',items);
  renderChecklist();closeModal('add-check-modal');
  document.getElementById('new-check-cat').value='';document.getElementById('new-check-text').value='';
  toast('Item added','ok');
}
function renderStrategyRules(){
  const rules=DB.get('rules',[]);
  const el=document.getElementById('strategy-rules-list');if(!el)return;
  el.innerHTML=rules.map((r,i)=>`
    <div class="check-item">
      <div style="width:20px;height:20px;background:var(--accent-dim);border:1px solid var(--accent-border);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--accent);flex-shrink:0;">${i+1}</div>
      <div style="flex:1;font-size:13px;">${r}</div>
      <button onclick="removeRule(${i})" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;" onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--text-muted)'">×</button>
    </div>`).join('')||'<div style="color:var(--text-muted);font-size:13px;">No rules yet</div>';
}
function addStrategyRule(){const text=document.getElementById('new-rule-text').value.trim();if(!text)return;const rules=DB.get('rules',[]);rules.push(text);DB.set('rules',rules);renderStrategyRules();closeModal('add-rule-modal');document.getElementById('new-rule-text').value='';toast('Rule added','ok');}
function removeRule(i){const r=DB.get('rules',[]);r.splice(i,1);DB.set('rules',r);renderStrategyRules();}

// -
// PREP NOTES
// -
function savePrepNotes(){DB.set('prep_'+todayStr(),{bias:document.getElementById('prep-bias').value,htf:document.getElementById('prep-htf').value,session:document.getElementById('prep-session').value,levels:document.getElementById('prep-levels').value,news:document.getElementById('prep-news').value,liquidity:document.getElementById('prep-liquidity').value,notes:document.getElementById('prep-notes').value});}
function loadPrepNotes(){const d=DB.get('prep_'+todayStr(),{});['bias','htf','session','levels','news','liquidity','notes'].forEach(k=>{const el=document.getElementById('prep-'+k);if(el&&d[k])el.value=d[k];});}

// -
// CONFLUENCE
// -
window._conflSelected=[];
function renderConflGrid(){
  document.getElementById('confl-grid').innerHTML=conflItems.map(c=>`
    <div class="confl-item ${_conflSelected.includes(c)?'on':''}" onclick="toggleConfl('${c.replace(/'/g,"\\'")}')">
      <div class="confl-box"></div><div class="confl-label">${c}</div>
    </div>`).join('');
}
function toggleConfl(c){if(_conflSelected.includes(c))_conflSelected=_conflSelected.filter(x=>x!==c);else _conflSelected.push(c);renderConflGrid();}
function renderConflSettings(){
  const el=document.getElementById('confl-settings-list');if(!el)return;
  el.innerHTML=conflItems.map((c,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-subtle);font-size:13px;"><span>${c}</span><button onclick="removeConflItem(${i})" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px;">×</button></div>`).join('');
}
function addConflItem(){const n=prompt('New confluence item:');if(!n?.trim())return;conflItems.push(n.trim());DB.set('confl_items',conflItems);renderConflGrid();renderConflSettings();toast('Added','ok');}
function removeConflItem(i){conflItems.splice(i,1);DB.set('confl_items',conflItems);renderConflGrid();renderConflSettings();}

// -
// PSYCH + EQ
// -
const psychStates=['😌 Calm','💪 Confident','😰 Fearful','💰 Greedy','😤 Frustrated','⚡ Impatient','😤 Anxious','🤑 Overconfident'];
const eqLevels=['A+ Entry','Good Entry','Okay Entry','Early Entry','Late Entry','Perfect Exit','Partial Fill','Missed Target'];
function renderPsychGrid(){document.getElementById('psych-grid').innerHTML=psychStates.map(s=>`<div class="psych-btn ${selectedPsych===s?'sel':''}" onclick="selectPsych('${s.replace(/'/g,"\\'")}')">${s}</div>`).join('');}
function renderEQGrid(){document.getElementById('eq-grid').innerHTML=eqLevels.map(l=>`<div class="eq-btn ${selectedEQ.includes(l)?'sel':''}" onclick="toggleEQ('${l.replace(/'/g,"\\'")}')">${l}</div>`).join('');}
function selectPsych(s){selectedPsych=selectedPsych===s?'':s;renderPsychGrid();}
function toggleEQ(l){if(selectedEQ.includes(l))selectedEQ=selectedEQ.filter(x=>x!==l);else selectedEQ.push(l);renderEQGrid();}

// -
// IMAGES
// -
function handleImgFiles(files){
  Array.from(files).forEach(f=>{const r=new FileReader();r.onload=e=>{currentTradeImages.push({data:e.target.result,name:f.name});updateImgUI();};r.readAsDataURL(f);});
}
function updateImgUI(){
  const thumbs=document.getElementById('trade-img-thumbs');
  const ph=document.getElementById('trade-img-placeholder');
  if(!currentTradeImages.length){thumbs.style.display='none';ph.style.display='block';return;}
  ph.style.display='none';thumbs.style.display='flex';
  thumbs.innerHTML=currentTradeImages.map((img,i)=>`
    <div class="img-thumb-item">
      <img src="${img.data}" alt="${img.name}" onclick="openImgFromTrade(${i})">
      <button class="img-thumb-del" onclick="event.stopPropagation();removeTradeImg(${i})">×</button>
    </div>`).join('');
}
function removeTradeImg(i){currentTradeImages.splice(i,1);updateImgUI();}
function openImgFromTrade(i){currentImgModalImages=currentTradeImages.map(x=>x.data);currentImgModalIdx=i;openImgModalWithIdx(i);}

// -
// AUTO CALC
// -
function autoCalcPnl(){
  const entry=parseFloat(document.getElementById('trade-entry').value)||0;
  const exit=parseFloat(document.getElementById('trade-exit').value)||0;
  const qty=parseFloat(document.getElementById('trade-qty').value)||1;
  const sl=parseFloat(document.getElementById('trade-sl').value)||0;
  const dir=document.getElementById('trade-dir').value;
  if(entry&&exit){
    const pnl=dir==='Long'?(exit-entry)*qty:(entry-exit)*qty;
    document.getElementById('trade-pnl').value=parseFloat(pnl.toFixed(2));
    document.getElementById('trade-outcome').value=pnl>0?'Win':pnl<0?'Loss':'Breakeven';
    if(entry&&sl){const rr=Math.abs((exit-entry)/(entry-sl));document.getElementById('trade-rr').value=rr.toFixed(2);}
  }
}

// -
// LOG TRADE
// -
function logTrade(){
  const date=document.getElementById('trade-date').value;
  const symbol=document.getElementById('trade-symbol').value.trim();
  if(!date||!symbol){toast('Date and Symbol required','error');return;}
  const entry=parseFloat(document.getElementById('trade-entry').value)||0;
  const exit=parseFloat(document.getElementById('trade-exit').value)||0;
  const qty=parseFloat(document.getElementById('trade-qty').value)||1;
  const dir=document.getElementById('trade-dir').value;
  let pnl=parseFloat(document.getElementById('trade-pnl').value);
  if(!pnl&&entry&&exit)pnl=dir==='Long'?(exit-entry)*qty:(entry-exit)*qty;
  const trade={
    id:Date.now(),date,symbol,
    accountId:document.getElementById('trade-account').value||getAccounts()[0]?.id,
    setup:document.getElementById('trade-setup').value.trim(),
    session:document.getElementById('trade-session').value,
    dir,entry,exit,sl:parseFloat(document.getElementById('trade-sl').value)||0,qty,
    pnl:parseFloat((pnl||0).toFixed(2)),
    rr:parseFloat(document.getElementById('trade-rr').value)||null,
    outcome:document.getElementById('trade-outcome').value,
    htf:document.getElementById('trade-htf').value,
    liquidity:document.getElementById('trade-liquidity').value.trim(),
    thesis:document.getElementById('trade-thesis').value.trim(),
    confluence:[..._conflSelected],
    emotion:selectedPsych,
    execQuality:[...selectedEQ],
    mistake:document.getElementById('trade-mistake').value,
    ruleAdhere:document.getElementById('trade-rule-adhere').value,
    notes:document.getElementById('trade-notes').value.trim(),
    reflection:document.getElementById('trade-reflection').value.trim(),
    images:currentTradeImages.map(x=>({data:x.data,name:x.name})),
    grade:'',loggedAt:new Date().toISOString(),
  };
  const trades=DB.get('trades',[]);trades.push(trade);DB.set('trades',trades);
  clearTradeForm();renderTradeLog();updateAIKPIs();renderDashboard();
  toast('Trade logged!','ok');
}
function clearTradeForm(){
  ['trade-symbol','trade-setup','trade-entry','trade-sl','trade-exit','trade-pnl','trade-rr','trade-notes','trade-reflection','trade-thesis','trade-liquidity','trade-qty'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('trade-session').value='';
  document.getElementById('trade-htf').value='';
  document.getElementById('trade-outcome').value='Win';
  document.getElementById('trade-mistake').value='';
  document.getElementById('trade-rule-adhere').value='';
  document.getElementById('trade-dir').value='Long';
  document.getElementById('trade-date').value=todayStr();
  currentTradeImages=[];window._conflSelected=[];selectedPsych='';selectedEQ=[];
  updateImgUI();renderConflGrid();renderPsychGrid();renderEQGrid();
}
function deleteTrade(id){
  if(!confirm('Delete this trade?'))return;
  DB.set('trades',DB.get('trades',[]).filter(t=>t.id!==id));
  renderTradeLog();if(_tdTrade&&_tdTrade.id===id)closeTD();updateAIKPIs();renderDashboard();
  toast('Trade deleted');
}

// -
// TRADE LOG
// -
function clearFilters(){['filter-search','filter-outcome','filter-session','filter-date'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});renderTradeLog();}
function renderTradeLog(){
  let trades=accountTrades(getActiveAccount());
  const search=(document.getElementById('filter-search')?.value||'').toLowerCase();
  const outcome=document.getElementById('filter-outcome')?.value||'';
  const session=document.getElementById('filter-session')?.value||'';
  const date=document.getElementById('filter-date')?.value||'';
  if(search)trades=trades.filter(t=>(t.symbol||'').toLowerCase().includes(search)||(t.setup||'').toLowerCase().includes(search));
  if(outcome)trades=trades.filter(t=>t.outcome===outcome);
  if(session)trades=trades.filter(t=>t.session===session);
  if(date)trades=trades.filter(t=>t.date===date);
  trades=trades.slice().reverse();
  const body=document.getElementById('trade-log-body');
  const empty=document.getElementById('trade-log-empty');
  if(!body)return;
  if(!trades.length){body.innerHTML='';if(empty)empty.style.display='block';return;}
  if(empty)empty.style.display='none';
  const gc={A:'gb-A',B:'gb-B',C:'gb-C',D:'gb-D',F:'gb-F'};
  body.innerHTML=trades.map(t=>`
    <tr class="tr-click" onclick="openTD(${t.id})">
      <td style="color:var(--text-muted);font-family:var(--font-jet);font-size:11px;">${t.date}</td>
      <td style="font-weight:600;">${t.symbol}</td>
      <td style="color:var(--text-secondary);">${t.setup||'—'}</td>
      <td style="font-size:11px;color:var(--cyan);">${t.session||'—'}</td>
      <td style="color:${t.dir==='Long'?'var(--green)':'var(--red)'};font-family:var(--font-jet);font-size:11px;">${t.dir}</td>
      <td style="font-family:var(--font-jet);font-size:11px;">${t.entry||'—'}</td>
      <td style="font-family:var(--font-jet);font-size:11px;">${t.exit||'—'}</td>
      <td style="font-family:var(--font-jet);font-weight:700;color:${(t.pnl||0)>=0?'var(--green)':'var(--red)'};">${(t.pnl||0)>=0?'+':''}$${(t.pnl||0).toLocaleString()}</td>
      <td style="font-family:var(--font-jet);font-size:11px;color:var(--text-muted);">${t.rr?t.rr+'R':'—'}</td>
      <td><span class="tag ${t.outcome==='Win'?'tag-win':t.outcome==='Loss'?'tag-loss':'tag-be'}">${t.outcome}</span></td>
      <td style="font-size:11px;color:var(--text-muted);">${t.emotion||'—'}</td>
      <td>${t.grade?`<span class="grade-badge ${gc[t.grade]||''}" style="width:24px;height:24px;font-size:11px;">${t.grade}</span>`:'<span style="color:var(--text-muted);">—</span>'}</td>
      <td>${t.aiAnalysis?'<span style="color:var(--accent);font-size:12px;">⚡</span>':''}</td>
      <td><button class="btn btn-danger btn-xs" onclick="event.stopPropagation();deleteTrade(${t.id})">×</button></td>
    </tr>`).join('');
}

// -
// CALENDAR
// -
function renderCalendar(){
  const trades=DB.get('trades',[]);
  const monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const ml=document.getElementById('cal-month-label');if(!ml)return;
  ml.textContent=`${monthNames[calMonth]} ${calYear}`;
  const pnlMap={},countMap={};
  trades.forEach(t=>{if(!pnlMap[t.date]){pnlMap[t.date]=0;countMap[t.date]=0;}pnlMap[t.date]+=(t.pnl||0);countMap[t.date]++;});
  const prefix=`${calYear}-${String(calMonth+1).padStart(2,'0')}-`;
  const mk=Object.keys(pnlMap).filter(k=>k.startsWith(prefix));
  const monthPnl=mk.reduce((s,k)=>s+pnlMap[k],0);
  const winDays=mk.filter(k=>pnlMap[k]>0).length,lossDays=mk.filter(k=>pnlMap[k]<0).length,tradeDays=winDays+lossDays;
  const mp=document.getElementById('cal-month-pnl');
  if(mp){mp.textContent=`${monthPnl>=0?'+':''}$${Math.abs(Math.round(monthPnl)).toLocaleString()}`;mp.className='stat-value '+(monthPnl>0?'pos':monthPnl<0?'neg':'');}
  document.getElementById('cal-win-days').textContent=winDays;
  document.getElementById('cal-loss-days').textContent=lossDays;
  document.getElementById('cal-winrate').textContent=tradeDays?`${Math.round(winDays/tradeDays*100)}%`:'0%';
  const firstDay=new Date(calYear,calMonth,1);
  let startDow=firstDay.getDay();startDow=startDow===0?6:startDow-1;
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const daysInPrev=new Date(calYear,calMonth,0).getDate();
  const today=todayStr();
  const cells=document.getElementById('cal-cells');cells.innerHTML='';
  for(let i=startDow-1;i>=0;i--){const c=document.createElement('div');c.className='cal-cell other';c.innerHTML=`<div class="cal-d">${daysInPrev-i}</div>`;cells.appendChild(c);}
  for(let d=1;d<=daysInMonth;d++){
    const ds=`${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const pnl=pnlMap[ds];const cnt=countMap[ds]||0;
    const c=document.createElement('div');
    c.className='cal-cell'+(ds===today?' today':'')+(pnl!==undefined?(pnl>0?' cal-win':' cal-loss'):'');
    c.onclick=()=>showCalDay(ds);
    c.innerHTML=`<div class="cal-d">${d}</div>${pnl!==undefined?`<div class="cal-pnl" style="color:${pnl>=0?'var(--green)':'var(--red)'};">${pnl>=0?'+':''}$${Math.abs(Math.round(pnl)).toLocaleString()}</div>`:''}${cnt>0?`<div class="cal-cnt">${cnt} trade${cnt!==1?'s':''}</div>`:''}`;
    cells.appendChild(c);
  }
  const rem=(startDow+daysInMonth)%7===0?0:7-((startDow+daysInMonth)%7);
  for(let i=1;i<=rem;i++){const c=document.createElement('div');c.className='cal-cell other';c.innerHTML=`<div class="cal-d">${i}</div>`;cells.appendChild(c);}
}
function calPrev(){calMonth--;if(calMonth<0){calMonth=11;calYear--;}renderCalendar();}
function calNext(){calMonth++;if(calMonth>11){calMonth=0;calYear++;}renderCalendar();}
function showCalDay(ds){
  const trades=DB.get('trades',[]).filter(t=>t.date===ds);if(!trades.length)return;
  const det=document.getElementById('cal-day-detail');const ttl=document.getElementById('cal-day-title');const trds=document.getElementById('cal-day-trades');if(!det)return;
  const pnl=trades.reduce((s,t)=>s+(t.pnl||0),0);
  ttl.textContent=`${ds} — ${trades.length} trade${trades.length!==1?'s':''} — ${pnl>=0?'+':''}$${Math.round(pnl).toLocaleString()}`;
  trds.innerHTML=`<table><tbody>${trades.map(t=>`<tr class="tr-click" onclick="openTD(${t.id})"><td>${t.symbol}</td><td style="color:${t.dir==='Long'?'var(--green)':'var(--red)'};">${t.dir}</td><td><span class="tag ${t.outcome==='Win'?'tag-win':t.outcome==='Loss'?'tag-loss':'tag-be'}">${t.outcome}</span></td><td style="font-family:var(--font-jet);font-weight:700;color:${(t.pnl||0)>=0?'var(--green)':'var(--red)'};">${(t.pnl||0)>=0?'+':''}$${(t.pnl||0).toLocaleString()}</td></tr>`).join('')}</tbody></table>`;
  det.style.display='block';
}

// -
// ANALYTICS
// -
function renderAnalytics(){
  const trades=DB.get('trades',[]);
  const total=trades.length,wins=trades.filter(t=>t.outcome==='Win'),losses=trades.filter(t=>t.outcome==='Loss'),be=trades.filter(t=>t.outcome==='Breakeven');
  const totalPnl=trades.reduce((s,t)=>s+(t.pnl||0),0);
  const winRate=total?(wins.length/total*100).toFixed(1):0;
  const avgWin=wins.length?wins.reduce((s,t)=>s+(t.pnl||0),0)/wins.length:0;
  const avgLoss=losses.length?losses.reduce((s,t)=>s+(t.pnl||0),0)/losses.length:0;
  const expectancy=total?(wins.length/total*avgWin+losses.length/total*avgLoss).toFixed(2):0;
  const profitFactor=losses.length&&losses.reduce((s,t)=>s+Math.abs(t.pnl||0),0)?(wins.reduce((s,t)=>s+(t.pnl||0),0)/Math.abs(losses.reduce((s,t)=>s+(t.pnl||0),0))).toFixed(2):'∞';
  const maxDD=getMaxDrawdown(trades);
  const sorted=[...trades].sort((a,b)=>a.date.localeCompare(b.date));
  let streak=0,streakType='';
  for(let i=sorted.length-1;i>=0;i--){if(!streakType){streakType=sorted[i].outcome;streak=1;}else if(sorted[i].outcome===streakType)streak++;else break;}
  const sb=document.getElementById('streak-badge');
  if(sb&&streak>1)sb.innerHTML=`<span class="badge ${streakType==='Win'?'badge-accent':'badge-blue'}">${streak} ${streakType} Streak</span>`;
  const kpiEl=document.getElementById('analytics-kpis');
  if(kpiEl)kpiEl.innerHTML=`
    <div class="stat-card acc"><div class="stat-label">Total P&L</div><div class="stat-value ${totalPnl>=0?'pos':'neg'}">${totalPnl>=0?'+':''}$${Math.round(totalPnl).toLocaleString()}</div></div>
    <div class="stat-card pos"><div class="stat-label">Win Rate</div><div class="stat-value pos">${winRate}%</div></div>
    <div class="stat-card neu"><div class="stat-label">Profit Factor</div><div class="stat-value neu">${profitFactor}</div></div>
    <div class="stat-card amb"><div class="stat-label">Expectancy</div><div class="stat-value ${expectancy>=0?'pos':'neg'}">${expectancy>=0?'+':''}$${expectancy}</div></div>
    <div class="stat-card pur"><div class="stat-label">Max Drawdown</div><div class="stat-value neg">-$${Math.abs(Math.round(maxDD)).toLocaleString()}</div></div>`;
  let cum=0;const cumData=sorted.map(t=>{cum+=(t.pnl||0);return parseFloat(cum.toFixed(2));});
  const pal={color:'#ffffff',bg:'rgba(255,255,255,0.07)'};
  destroyChart('equity');
  charts.equity=new Chart(document.getElementById('equity-chart'),{type:'line',data:{labels:sorted.map(t=>t.date.slice(5)),datasets:[{data:cumData,borderColor:pal.color,backgroundColor:pal.bg,fill:true,tension:0.3,pointRadius:total>80?0:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#555555',font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}},y:{ticks:{color:'#555555',callback:v=>'$'+v.toLocaleString()},grid:{color:'rgba(255,255,255,0.03)'}}}}});
  destroyChart('outcome');
  charts.outcome=new Chart(document.getElementById('outcome-chart'),{type:'doughnut',data:{labels:['Win','Loss','Breakeven'],datasets:[{data:[wins.length,losses.length,be.length],backgroundColor:['#ffffff','#f87171','#fbbf24'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#555555',font:{size:11},padding:12}}}}});
  const sessions={Asian:{pnl:0,wins:0,count:0},'London Open':{pnl:0,wins:0,count:0},'NY Open':{pnl:0,wins:0,count:0},'London Close':{pnl:0,wins:0,count:0},'NY PM':{pnl:0,wins:0,count:0}};
  trades.filter(t=>t.session&&sessions[t.session]).forEach(t=>{sessions[t.session].pnl+=(t.pnl||0);sessions[t.session].count++;if(t.outcome==='Win')sessions[t.session].wins++;});
  const maxSPnl=Math.max(...Object.values(sessions).map(s=>Math.abs(s.pnl)),1);
  const saEl=document.getElementById('session-analytics');
  if(saEl)saEl.innerHTML=Object.entries(sessions).map(([name,s])=>`<div class="session-bar"><div class="session-name">${name}</div><div class="session-track"><div class="session-fill" style="width:${(Math.abs(s.pnl)/maxSPnl*100).toFixed(0)}%;background:${s.pnl>=0?'var(--green)':'var(--red)'}"></div></div><div class="session-pnl" style="color:${s.pnl>=0?'var(--green)':'var(--red)'};">${s.pnl>=0?'+':''}$${Math.round(s.pnl).toLocaleString()}</div><div class="session-wr">${s.count?Math.round(s.wins/s.count*100)+'%':'—'}</div></div>`).join('');
  const wdMap={Mon:{pnl:0,wins:0,count:0},Tue:{pnl:0,wins:0,count:0},Wed:{pnl:0,wins:0,count:0},Thu:{pnl:0,wins:0,count:0},Fri:{pnl:0,wins:0,count:0}};
  const wdNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  trades.forEach(t=>{const wd=wdNames[new Date(t.date).getDay()];if(wdMap[wd]){wdMap[wd].pnl+=(t.pnl||0);wdMap[wd].count++;if(t.outcome==='Win')wdMap[wd].wins++;}});
  const maxWD=Math.max(...Object.values(wdMap).map(s=>Math.abs(s.pnl)),1);
  const waEl=document.getElementById('weekday-analytics');
  if(waEl)waEl.innerHTML=Object.entries(wdMap).map(([day,s])=>`<div class="session-bar"><div class="session-name">${day}</div><div class="session-track"><div class="session-fill" style="width:${(Math.abs(s.pnl)/maxWD*100).toFixed(0)}%;background:${s.pnl>=0?'var(--green)':'var(--red)'}"></div></div><div class="session-pnl" style="color:${s.pnl>=0?'var(--green)':'var(--red)'};">${s.pnl>=0?'+':''}$${Math.round(s.pnl).toLocaleString()}</div><div class="session-wr">${s.count?Math.round(s.wins/s.count*100)+'%':'—'}</div></div>`).join('');
  const setupMap={};
  trades.forEach(t=>{const s=t.setup||'Other';if(!setupMap[s])setupMap[s]={pnl:0,wins:0,total:0};setupMap[s].pnl+=(t.pnl||0);setupMap[s].total++;if(t.outcome==='Win')setupMap[s].wins++;});
  const sk=Object.keys(setupMap).sort((a,b)=>setupMap[b].pnl-setupMap[a].pnl);
  const maxSetupPnl=Math.max(...sk.map(k=>Math.abs(setupMap[k].pnl)),1);
  const smEl=document.getElementById('setup-matrix');
  if(smEl)smEl.innerHTML=sk.slice(0,10).map(k=>`<div class="setup-row" onclick="aiAsk('Tell me about my ${k} setup performance')"><div class="setup-name">${k}</div><div style="font-family:var(--font-jet);font-size:10px;color:var(--text-muted);width:36px;">${setupMap[k].total}T</div><div style="font-family:var(--font-jet);font-size:10px;width:36px;color:${setupMap[k].wins/setupMap[k].total>=.5?'var(--green)':'var(--red)'};">${Math.round(setupMap[k].wins/setupMap[k].total*100)}%</div><div class="setup-bar-wrap"><div class="setup-bar-fill" style="width:${(Math.abs(setupMap[k].pnl)/maxSetupPnl*100).toFixed(0)}%;background:${setupMap[k].pnl>=0?'var(--green)':'var(--red)'}"></div></div><div class="setup-stat" style="color:${setupMap[k].pnl>=0?'var(--green)':'var(--red)'};">${setupMap[k].pnl>=0?'+':''}$${Math.round(setupMap[k].pnl).toLocaleString()}</div></div>`).join('')||'<div style="color:var(--text-muted);font-size:13px;padding:8px;">Log trades with setups to see the matrix</div>';
  const emoMap={};
  trades.filter(t=>t.emotion).forEach(t=>{if(!emoMap[t.emotion])emoMap[t.emotion]={pnl:0,count:0};emoMap[t.emotion].pnl+=(t.pnl||0);emoMap[t.emotion].count++;});
  const ek=Object.keys(emoMap).sort((a,b)=>emoMap[b].pnl-emoMap[a].pnl);
  destroyChart('emotionPnl');
  if(ek.length)charts.emotionPnl=new Chart(document.getElementById('emotion-pnl-chart'),{type:'bar',data:{labels:ek,datasets:[{data:ek.map(k=>parseFloat(emoMap[k].pnl.toFixed(2))),backgroundColor:ek.map(k=>emoMap[k].pnl>=0?'rgba(255,255,255,0.7)':'rgba(248,113,113,0.6)'),borderRadius:5}]},options:chartOpts(v=>'$'+v)});
  const mMap={};trades.filter(t=>t.mistake).forEach(t=>{mMap[t.mistake]=(mMap[t.mistake]||0)+1;});
  const mk2=Object.keys(mMap).sort((a,b)=>mMap[b]-mMap[a]);
  destroyChart('mistakeFreq');
  charts.mistakeFreq=new Chart(document.getElementById('mistake-freq-chart'),{type:'bar',data:{labels:mk2.length?mk2:['No mistakes'],datasets:[{data:mk2.length?mk2.map(k=>mMap[k]):[0],backgroundColor:'rgba(248,113,113,0.6)',borderRadius:4}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#555555',precision:0},grid:{color:'rgba(255,255,255,0.03)'}},y:{ticks:{color:'#555555',font:{size:10}},grid:{display:false}}}}});
  let peak=0,cumDD2=0;
  const ddData=sorted.map(t=>{cumDD2+=(t.pnl||0);if(cumDD2>peak)peak=cumDD2;return parseFloat(Math.min(0,cumDD2-peak).toFixed(2));});
  destroyChart('drawdown');
  charts.drawdown=new Chart(document.getElementById('drawdown-chart'),{type:'line',data:{labels:sorted.map(t=>t.date.slice(5)),datasets:[{data:ddData,borderColor:'#f87171',backgroundColor:'rgba(248,113,113,0.08)',fill:true,tension:0.3,pointRadius:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#555555',font:{size:10}},grid:{display:false}},y:{ticks:{color:'#555555',callback:v=>'$'+v.toLocaleString()},grid:{color:'rgba(255,255,255,0.03)'}}}}});
  const pnlBuckets=[-500,-300,-100,-50,-20,0,20,50,100,300,500];
  const distData=pnlBuckets.map((b,i)=>{const next=pnlBuckets[i+1];return trades.filter(t=>{const p=t.pnl||0;return next?p>=b&&p<next:p>=b;}).length;});
  destroyChart('pnlDist');
  charts.pnlDist=new Chart(document.getElementById('pnl-dist-chart'),{type:'bar',data:{labels:pnlBuckets.map((b,i)=>pnlBuckets[i+1]?`${b}→${pnlBuckets[i+1]}`:b+'+'),datasets:[{data:distData,backgroundColor:pnlBuckets.map(b=>b<0?'rgba(248,113,113,0.5)':'rgba(255,255,255,0.5)'),borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#555555',font:{size:9}},grid:{display:false}},y:{ticks:{color:'#555555',precision:0},grid:{color:'rgba(255,255,255,0.03)'}}}}});
  const bcEl=document.getElementById('best-conditions');
  if(bcEl){
    const bestSetup=sk[0]?{name:sk[0],pnl:setupMap[sk[0]].pnl,wr:Math.round(setupMap[sk[0]].wins/setupMap[sk[0]].total*100)}:null;
    const bestEmo=ek[0]?{name:ek[0],pnl:emoMap[ek[0]].pnl}:null;
    const bestWD=Object.entries(wdMap).sort((a,b)=>b[1].pnl-a[1].pnl)[0];
    const bestSess=Object.entries(sessions).sort((a,b)=>b[1].pnl-a[1].pnl)[0];
    const conditions=[
      bestSetup?{icon:'🎯',label:'Best Setup',val:bestSetup.name,sub:`+$${Math.round(bestSetup.pnl).toLocaleString()} · ${bestSetup.wr}% WR`}:{icon:'🎯',label:'Best Setup',val:'Insufficient data',sub:'Log more trades'},
      bestEmo?{icon:'🧠',label:'Best Emotion',val:bestEmo.name,sub:`+$${Math.round(bestEmo.pnl).toLocaleString()} total`}:{icon:'🧠',label:'Best Emotion',val:'Insufficient data',sub:'Log emotions'},
      bestWD?{icon:'📅',label:'Best Day',val:bestWD[0],sub:`+$${Math.round(bestWD[1].pnl).toLocaleString()} · ${bestWD[1].count} trades`}:{icon:'📅',label:'Best Day',val:'Insufficient data',sub:''},
      bestSess?{icon:'🕐',label:'Best Session',val:bestSess[0],sub:`+$${Math.round(bestSess[1].pnl).toLocaleString()}`}:{icon:'🕐',label:'Best Session',val:'Insufficient data',sub:''},
      {icon:'📊',label:'Expectancy',val:`${expectancy>=0?'+':''}$${expectancy}`,sub:'per trade average'},
      {icon:'⚖️',label:'Avg Win / Loss',val:`$${avgWin.toFixed(0)} / $${Math.abs(avgLoss).toFixed(0)}`,sub:'win/loss ratio'},
    ];
    bcEl.innerHTML=conditions.map(c=>`<div class="card" style="padding:16px;"><div style="font-size:20px;margin-bottom:8px;">${c.icon}</div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-family:var(--font-mono);">${c.label}</div><div style="font-size:14px;font-weight:600;color:var(--accent);">${c.val}</div><div style="font-size:11px;color:var(--text-muted);margin-top:3px;">${c.sub}</div></div>`).join('');
  }
  const sorted2=[...trades].sort((a,b)=>(b.pnl||0)-(a.pnl||0));
  const bwEl=document.getElementById('best-worst-table');
  if(bwEl)bwEl.innerHTML=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;"><div><div class="card-label">Best Trades</div>${sorted2.slice(0,3).map(t=>`<div class="metric-row"><span class="metric-label">${t.date} · ${t.symbol}</span><span class="metric-value" style="color:var(--green);">+$${(t.pnl||0).toLocaleString()}</span></div>`).join('')}</div><div><div class="card-label">Worst Trades</div>${sorted2.slice(-3).reverse().map(t=>`<div class="metric-row"><span class="metric-label">${t.date} · ${t.symbol}</span><span class="metric-value" style="color:var(--red);">$${(t.pnl||0).toLocaleString()}</span></div>`).join('')}</div></div>`;
}
function getMaxDrawdown(trades){const sorted=[...trades].sort((a,b)=>a.date.localeCompare(b.date));let peak=0,maxDD=0,cum=0;sorted.forEach(t=>{cum+=(t.pnl||0);if(cum>peak)peak=cum;const dd=cum-peak;if(dd<maxDD)maxDD=dd;});return maxDD;}

// -
// WEEKEND REVIEW
// -
function getWeekRange(){const now=new Date(),day=now.getDay(),diffMon=day===0?-6:1-day;const mon=new Date(now);mon.setDate(now.getDate()+diffMon+(_weekOffset*7));const fri=new Date(mon);fri.setDate(mon.getDate()+4);return{start:mon.toISOString().split('T')[0],end:fri.toISOString().split('T')[0]};}
function initWeekLabel(){const{start,end}=getWeekRange();const el=document.getElementById('week-nav-label');if(el)el.textContent=_weekOffset===0?`This Week (${start} → ${end})`:`${Math.abs(_weekOffset)}w ${_weekOffset>0?'ahead':'ago'} (${start} → ${end})`;}
function navWeek(dir){_weekOffset+=dir;renderWeekendReview();}
function renderWeekendReview(){
  initWeekLabel();
  const{start,end}=getWeekRange();
  const allTrades=DB.get('trades',[]);
  const trades=allTrades.filter(t=>t.date>=start&&t.date<=end);
  const wins=trades.filter(t=>t.outcome==='Win'),losses=trades.filter(t=>t.outcome==='Loss');
  const pnl=trades.reduce((s,t)=>s+(t.pnl||0),0);
  let score=50;
  if(trades.length>0){const noMistakePct=trades.filter(t=>!t.mistake).length/trades.length;const ruleFollowPct=trades.filter(t=>t.ruleAdhere==='Followed All Rules'||t.ruleAdhere==='Mostly Followed').length/trades.length;score=Math.round(noMistakePct*50+ruleFollowPct*30+(wins.length/trades.length)*20);}
  const scoreEl=document.getElementById('coach-score');
  if(scoreEl){scoreEl.textContent=trades.length?score:'—';scoreEl.style.color=score>=70?'var(--accent)':score>=40?'var(--amber)':'var(--red)';}
  const insightsEl=document.getElementById('coach-insights');
  if(insightsEl&&trades.length){const insights=[];if(wins.length/trades.length>=0.6)insights.push({icon:'✅',text:`Strong week — ${Math.round(wins.length/trades.length*100)}% win rate`});const mc=trades.filter(t=>t.mistake).length;if(mc)insights.push({icon:'⚠️',text:`${mc} mistake${mc!==1?'s':''} recorded — review before next week`});if(pnl>0)insights.push({icon:'📈',text:'Profitable week — keep momentum'});if(!insights.length)insights.push({icon:'📝',text:'Generate an AI report for deep analysis'});insightsEl.innerHTML=insights.map(i=>`<div class="insight-item"><span class="insight-icon">${i.icon}</span><span>${i.text}</span></div>`).join('');}
  const sumEl=document.getElementById('week-summary-stats');
  if(sumEl)sumEl.innerHTML=[['Week',`${start} → ${end}`],['Total P&L',`${pnl>=0?'+':''}$${Math.round(pnl).toLocaleString()}`],['Trades',trades.length],['Win Rate',trades.length?`${Math.round(wins.length/trades.length*100)}%`:'0%'],['Avg Win',wins.length?`$${Math.round(wins.reduce((s,t)=>s+(t.pnl||0),0)/wins.length).toLocaleString()}`:'$0'],['Avg Loss',losses.length?`$${Math.round(losses.reduce((s,t)=>s+(t.pnl||0),0)/losses.length).toLocaleString()}`:'$0']].map(([l,v])=>`<div class="metric-row"><span class="metric-label">${l}</span><span class="metric-value">${v}</span></div>`).join('');
  const days=['Mon','Tue','Wed','Thu','Fri'];const mon=new Date(start);
  const dayDates=days.map((_,i)=>{const d=new Date(mon);d.setDate(mon.getDate()+i);return d.toISOString().split('T')[0];});
  const dayPnls=dayDates.map(d=>parseFloat(trades.filter(t=>t.date===d).reduce((s,t)=>s+(t.pnl||0),0).toFixed(2)));
  destroyChart('weekPnl');
  charts.weekPnl=new Chart(document.getElementById('week-pnl-chart'),{type:'bar',data:{labels:days,datasets:[{data:dayPnls,backgroundColor:dayPnls.map(v=>v>=0?'rgba(255,255,255,0.7)':'rgba(248,113,113,0.6)'),borderRadius:5}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#555555'},grid:{display:false}},y:{ticks:{color:'#555555',callback:v=>'$'+v},grid:{color:'rgba(255,255,255,0.03)'}}}}});
  const mMap2={};trades.filter(t=>t.mistake).forEach(t=>{mMap2[t.mistake]=(mMap2[t.mistake]||0)+1;});const mk3=Object.keys(mMap2).sort((a,b)=>mMap2[b]-mMap2[a]);
  destroyChart('mistakeWeek');
  charts.mistakeWeek=new Chart(document.getElementById('mistake-chart'),{type:'bar',data:{labels:mk3.length?mk3:['No mistakes'],datasets:[{data:mk3.length?mk3.map(k=>mMap2[k]):[0],backgroundColor:'rgba(248,113,113,0.6)',borderRadius:4}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#555555',precision:0},grid:{color:'rgba(255,255,255,0.03)'}},y:{ticks:{color:'#555555',font:{size:10}},grid:{display:false}}}}});
  const emoMap2={};trades.filter(t=>t.emotion).forEach(t=>{emoMap2[t.emotion]=(emoMap2[t.emotion]||0)+1;});const ek2=Object.keys(emoMap2);
  destroyChart('emotionWeek');
  charts.emotionWeek=new Chart(document.getElementById('emotion-chart'),{type:'doughnut',data:{labels:ek2.length?ek2:['No data'],datasets:[{data:ek2.length?ek2.map(k=>emoMap2[k]):[1],backgroundColor:ek2.length?['#ffffff','#22d3ee','#fbbf24','#f87171','#a78bfa','#60a5fa']:['#344060'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#555555',font:{size:11},padding:10}}}}});
  const weeklyMap={};allTrades.forEach(t=>{const d=new Date(t.date),day=d.getDay(),diff=day===0?-6:1-day;const m2=new Date(d);m2.setDate(d.getDate()+diff);const wk=m2.toISOString().split('T')[0];if(!weeklyMap[wk])weeklyMap[wk]=0;weeklyMap[wk]+=(t.pnl||0);});
  const wkKeys=Object.keys(weeklyMap).sort();const wkVals=wkKeys.map(k=>parseFloat(weeklyMap[k].toFixed(2)));
  destroyChart('weeklyProgress');
  charts.weeklyProgress=new Chart(document.getElementById('weekly-progress-chart'),{type:'bar',data:{labels:wkKeys.map(k=>k.slice(5)),datasets:[{data:wkVals,backgroundColor:wkVals.map(v=>v>=0?'rgba(255,255,255,0.7)':'rgba(248,113,113,0.6)'),borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#555555',font:{size:10}},grid:{display:false}},y:{ticks:{color:'#555555',callback:v=>'$'+v.toLocaleString()},grid:{color:'rgba(255,255,255,0.03)'}}}}});
  const rv=DB.get('review_'+start,{});
  if(rv.good)document.getElementById('review-good').value=rv.good;
  if(rv.improve)document.getElementById('review-improve').value=rv.improve;
  if(rv.action)document.getElementById('review-action').value=rv.action;
}
function saveReview(){const{start}=getWeekRange();DB.set('review_'+start,{good:document.getElementById('review-good').value,improve:document.getElementById('review-improve').value,action:document.getElementById('review-action').value});}
async function generateWeeklyReport(){
  const k=getGroqKey();
  const mk=getMarketKey();
  const mkEl=document.getElementById('settings-market-key'); if(mkEl)mkEl.value=mk;
  if(mk && document.getElementById('page-simulator')?.classList.contains('active')) connectLiveMarket();if(!k){toast('Add Groq API key in Settings','error');return;}
  const{start,end}=getWeekRange();const trades=DB.get('trades',[]).filter(t=>t.date>=start&&t.date<=end);
  const btn=document.getElementById('weekly-report-btn');const repEl=document.getElementById('ai-weekly-report');
  if(btn)btn.textContent='⏳ Generating...';
  const wins=trades.filter(t=>t.outcome==='Win');const pnl=trades.reduce((s,t)=>s+(t.pnl||0),0);
  const mistakes=trades.filter(t=>t.mistake).map(t=>t.mistake);const emotions=[...new Set(trades.filter(t=>t.emotion).map(t=>t.emotion))];
  const good=document.getElementById('review-good').value;const improve=document.getElementById('review-improve').value;
  const prompt=`You are an elite trading coach reviewing this trader's week. Be sharp, direct, and data-driven.\n\nWEEK: ${start} → ${end}\nSTATS: ${trades.length} trades | Win Rate: ${trades.length?Math.round(wins.length/trades.length*100):0}% | P&L: $${Math.round(pnl).toLocaleString()}\nMISTAKES: ${mistakes.length?mistakes.join(', '):'None logged'}\nEMOTIONS: ${emotions.length?emotions.join(', '):'Not logged'}\nTRADER NOTES — Went well: ${good||'Not filled'} | Needs work: ${improve||'Not filled'}\nTRADES: ${trades.map(t=>`${t.date}: ${t.symbol} ${t.dir} $${t.pnl} ${t.outcome} ${t.mistake||''}`).join('\n')}\n\nProvide: **Week Summary** | **Discipline Score /100** | **Top 3 Mistakes** | **Best Pattern** | **3 Action Items** | **Mindset Assessment**\nBe direct. Max 300 words.`;
  try{const reply=await groqCall(k,prompt,600);repEl.innerHTML=mdToHtml(reply);repEl.style.display='block';if(btn)btn.textContent='⚡ AI Report';}
  catch(e){repEl.textContent='Error: '+e.message;repEl.style.display='block';if(btn)btn.textContent='Retry';}
}

// -
// PROP FIRM
// -
function savePropSetup(){
  const config={name:document.getElementById('prop-firm-name').value.trim(),account:parseFloat(document.getElementById('prop-account').value)||0,target:parseFloat(document.getElementById('prop-target').value)||0,dailyDD:parseFloat(document.getElementById('prop-daily-dd').value)||0,maxDD:parseFloat(document.getElementById('prop-max-dd').value)||0,minDays:parseInt(document.getElementById('prop-min-days').value)||0};
  if(!config.name||!config.account){toast('Fill firm name and account size','error');return;}
  DB.set('prop_config',config);closeModal('prop-setup-modal');renderPropFirm();toast('Challenge configured!','ok');
}
function renderPropFirm(){
  const config=DB.get('prop_config',null);
  const empty=document.getElementById('prop-empty'),grid=document.getElementById('prop-stats-grid'),det=document.getElementById('prop-detail'),banner=document.getElementById('prop-status-banner-area');
  if(!config||!config.account){if(empty)empty.style.display='block';if(grid)grid.style.display='none';if(det)det.style.display='none';if(banner)banner.innerHTML='';return;}
  if(empty)empty.style.display='none';if(grid)grid.style.display='grid';if(det)det.style.display='block';
  const trades=DB.get('trades',[]);const totalPnl=trades.reduce((s,t)=>s+(t.pnl||0),0);
  const todayPnl=trades.filter(t=>t.date===todayStr()).reduce((s,t)=>s+(t.pnl||0),0);
  const tradingDays=new Set(trades.map(t=>t.date)).size;const maxDD=Math.abs(getMaxDrawdown(trades));
  const profitProgress=Math.max(0,Math.min(100,(totalPnl/config.target)*100));
  const dailyDDUsed=Math.max(0,Math.min(100,(Math.abs(Math.min(0,todayPnl))/config.dailyDD)*100));
  const maxDDUsed=Math.max(0,Math.min(100,(maxDD/config.maxDD)*100));
  const breached=dailyDDUsed>=100||maxDDUsed>=100,warning=dailyDDUsed>=80||maxDDUsed>=80;
  if(banner)banner.innerHTML=`<div class="prop-status-banner ${breached?'prop-status-breach':warning?'prop-status-warning':'prop-status-active'}">${breached?'⛔ CHALLENGE BREACHED':warning?'⚠️ WARNING — Approaching limits':config.name+' — Challenge Active'}</div>`;
  const upd=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val;};
  upd('prop-profit-val',`$${Math.round(Math.max(0,totalPnl)).toLocaleString()}`);upd('prop-profit-target',`$${config.target.toLocaleString()}`);
  upd('prop-daily-val',`$${Math.abs(Math.round(Math.min(0,todayPnl))).toLocaleString()}`);upd('prop-daily-limit',`$${config.dailyDD.toLocaleString()}`);
  upd('prop-max-val',`$${Math.round(maxDD).toLocaleString()}`);upd('prop-max-limit',`$${config.maxDD.toLocaleString()}`);
  const setBar=(id,pct)=>{const el=document.getElementById(id);const parent=el?.closest('.prop-stat');if(el)el.style.width=pct+'%';if(parent){parent.className='prop-stat '+(pct>=100?'prop-danger':pct>=80?'prop-warn':'prop-ok');}};
  setBar('prop-profit-bar',profitProgress);setBar('prop-daily-bar',dailyDDUsed);setBar('prop-max-bar',maxDDUsed);
  const ftEl=document.getElementById('prop-firm-title');if(ftEl)ftEl.textContent=config.name;
  const pmEl=document.getElementById('prop-metrics');
  if(pmEl)pmEl.innerHTML=`<div class="g3" style="gap:12px;margin-bottom:16px;"><div><div class="metric-row"><span class="metric-label">Account Size</span><span class="metric-value">$${config.account.toLocaleString()}</span></div></div><div><div class="metric-row"><span class="metric-label">Total P&L</span><span class="metric-value" style="color:${totalPnl>=0?'var(--green)':'var(--red)'};">${totalPnl>=0?'+':''}$${Math.round(totalPnl).toLocaleString()}</span></div></div><div><div class="metric-row"><span class="metric-label">Trading Days</span><span class="metric-value">${tradingDays} / ${config.minDays}</span></div></div></div>`;
}

// -
// TRADE DETAIL MODAL
// -
function openTD(id){_tdTradeList=DB.get('trades',[]).slice().reverse();_tdIdx=_tdTradeList.findIndex(t=>t.id===id);if(_tdIdx<0)return;loadTD(_tdTradeList[_tdIdx]);}
function prevTrade(){if(_tdIdx>0){_tdIdx--;loadTD(_tdTradeList[_tdIdx]);}}
function nextTrade(){if(_tdIdx<_tdTradeList.length-1){_tdIdx++;loadTD(_tdTradeList[_tdIdx]);}}
function loadTD(t){
  _tdTrade=t;
  document.getElementById('td-title').textContent=`${t.symbol} · ${t.dir} · ${t.date}`;
  const gc={A:'gb-A',B:'gb-B',C:'gb-C',D:'gb-D',F:'gb-F'};
  const gd=document.getElementById('td-grade-display');gd.textContent=t.grade||'—';gd.className=`grade-badge ${gc[t.grade]||''}`;
  const rrDisplay=t.entry&&t.sl&&t.exit?Math.abs((t.exit-t.entry)/(t.entry-t.sl)).toFixed(2):t.rr?t.rr+'R':'—';
  document.getElementById('td-kpis').innerHTML=`
    <div class="td-kpi"><div class="td-kpi-l">P&L</div><div class="td-kpi-v" style="color:${(t.pnl||0)>=0?'var(--green)':'var(--red)'};">${(t.pnl||0)>=0?'+':''}$${(t.pnl||0).toLocaleString()}</div></div>
    <div class="td-kpi"><div class="td-kpi-l">Entry</div><div class="td-kpi-v">${t.entry||'—'}</div></div>
    <div class="td-kpi"><div class="td-kpi-l">Exit</div><div class="td-kpi-v">${t.exit||'—'}</div></div>
    <div class="td-kpi"><div class="td-kpi-l">R:R</div><div class="td-kpi-v" style="color:var(--cyan);">${rrDisplay}</div></div>
    <div class="td-kpi"><div class="td-kpi-l">Session</div><div class="td-kpi-v" style="font-size:12px;">${t.session||'—'}</div></div>
    <div class="td-kpi"><div class="td-kpi-l">Qty</div><div class="td-kpi-v">${t.qty||'—'}</div></div>`;
  const tags=document.getElementById('td-tags');
  let th=`<span class="tag ${t.outcome==='Win'?'tag-win':t.outcome==='Loss'?'tag-loss':'tag-be'}">${t.outcome}</span>`;
  if(t.emotion)th+=`<span style="background:rgba(34,211,238,0.1);color:var(--cyan);border:1px solid rgba(34,211,238,0.2);border-radius:5px;padding:3px 8px;font-size:10px;">${t.emotion}</span>`;
  if(t.mistake)th+=`<span style="background:rgba(248,113,113,0.1);color:var(--red);border:1px solid rgba(248,113,113,0.2);border-radius:5px;padding:3px 8px;font-size:10px;">⚠ ${t.mistake}</span>`;
  if(t.ruleAdhere)th+=`<span class="badge badge-blue">${t.ruleAdhere}</span>`;
  if(t.aiAnalysis)th+=`<span class="badge badge-accent">⚡ AI</span>`;
  if(t.htf)th+=`<span style="background:var(--accent-dim);color:var(--accent);border-radius:5px;padding:3px 8px;font-size:10px;">${t.htf}</span>`;
  tags.innerHTML=th;
  const images=t.images||(t.image?[{data:t.image,name:'Chart'}]:[]);
  const galSec=document.getElementById('td-gallery-sec');
  if(images.length){galSec.style.display='block';document.getElementById('td-main-img').src=images[0].data;currentImgModalImages=images.map(x=>x.data||x);currentImgModalIdx=0;
    document.getElementById('td-thumbs').innerHTML=images.map((img,i)=>`<div class="td-thumb ${i===0?'active':''}" onclick="setTDImg(${i},this)"><img src="${img.data||img}" alt="${img.name||'Chart'}"></div>`).join('')+`<div style="width:58px;height:42px;border-radius:var(--radius-xs);border:1.5px dashed var(--border-default);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--text-muted);" onclick="document.getElementById('trade-img-file').click()">+</div>`;}
  else galSec.style.display='none';
  const confSec=document.getElementById('td-confluence-sec');const confTxt=document.getElementById('td-confluence-txt');
  if((t.confluence||[]).length){confSec.style.display='block';confTxt.innerHTML=(t.confluence||[]).map(c=>`<span style="display:inline-block;background:var(--accent-dim);border:1px solid var(--accent-border);border-radius:5px;padding:2px 8px;font-size:11px;margin:2px;color:var(--accent);">✓ ${c}</span>`).join('');}
  else confSec.style.display='none';
  const show=(secId,txtId,val)=>{const sec=document.getElementById(secId);const txt=document.getElementById(txtId);if(val&&val.trim()){sec.style.display='block';txt.textContent=val;}else sec.style.display='none';};
  show('td-thesis-sec','td-thesis-txt',t.thesis);show('td-notes-sec','td-notes-txt',t.notes);show('td-reflection-sec','td-reflection-txt',t.reflection);
  document.getElementById('td-grade-select').innerHTML=['A','B','C','D','F'].map(g=>`<button class="grade-btn ${g}${t.grade===g?' sel':''}" onclick="setTDGrade('${g}')">${g}</button>`).join('');
  const aiResp=document.getElementById('td-ai-resp');const aiBtn=document.getElementById('td-ai-btn');
  if(t.aiAnalysis){aiResp.innerHTML=mdToHtml(t.aiAnalysis);aiResp.classList.add('show');aiBtn.textContent='↺ Re-analyse';}
  else{aiResp.classList.remove('show');aiResp.innerHTML='';aiBtn.textContent='⚡ Analyse This Trade';}
  aiBtn.disabled=false;
  document.getElementById('td-modal').classList.add('open');document.body.style.overflow='hidden';
}
function setTDImg(i,el){currentImgModalIdx=i;const imgs=_tdTrade?.images||(_tdTrade?.image?[{data:_tdTrade.image}]:[]);if(imgs[i])document.getElementById('td-main-img').src=imgs[i].data||imgs[i];document.querySelectorAll('.td-thumb').forEach((t,idx)=>t.classList.toggle('active',idx===i));}
function setTDGrade(g){if(!_tdTrade)return;_tdTrade.grade=g;const trades=DB.get('trades',[]);const idx=trades.findIndex(t=>t.id===_tdTrade.id);if(idx>-1){trades[idx].grade=g;DB.set('trades',trades);}document.getElementById('td-grade-select').innerHTML=['A','B','C','D','F'].map(gr=>`<button class="grade-btn ${gr}${g===gr?' sel':''}" onclick="setTDGrade('${gr}')">${gr}</button>`).join('');const gc={A:'gb-A',B:'gb-B',C:'gb-C',D:'gb-D',F:'gb-F'};const gd=document.getElementById('td-grade-display');gd.textContent=g;gd.className=`grade-badge ${gc[g]||''}`;renderTradeLog();}
function editTrade(){if(!_tdTrade)return;closeTD();showPage('journal',document.querySelectorAll('.nav-item')[3]);const t=_tdTrade;['date','symbol','setup','dir','entry','exit','sl','qty','pnl','outcome','session','htf','liquidity','thesis','notes','reflection'].forEach(k=>{const el=document.getElementById('trade-'+k);if(el&&t[k]!==undefined&&t[k]!==null)el.value=t[k];});if(t.rr)document.getElementById('trade-rr').value=t.rr;if(t.mistake)document.getElementById('trade-mistake').value=t.mistake;if(t.ruleAdhere)document.getElementById('trade-rule-adhere').value=t.ruleAdhere;if(t.emotion){selectedPsych=t.emotion;renderPsychGrid();}if(t.confluence){window._conflSelected=[...t.confluence];renderConflGrid();}if(t.images){currentTradeImages=t.images.map(x=>({data:x.data||x,name:x.name||'Chart'}));updateImgUI();}DB.set('trades',DB.get('trades',[]).filter(x=>x.id!==t.id));renderTradeLog();toast('Editing trade — re-log when done','ok');}
function closeTD(){document.getElementById('td-modal').classList.remove('open');document.body.style.overflow='';_tdTrade=null;}

// -
// IMAGE MODAL
// -
function openImgModal(){openImgModalWithIdx(currentImgModalIdx);}
function openImgModalWithIdx(i){
  if(!currentImgModalImages.length)return;currentImgModalIdx=i;
  const modal=document.getElementById('img-modal'),img=document.getElementById('img-modal-img'),info=document.getElementById('img-modal-info'),nav=document.getElementById('img-modal-nav');
  img.src=currentImgModalImages[i]?.data||currentImgModalImages[i]||'';
  info.textContent=`${i+1} / ${currentImgModalImages.length}`;
  nav.innerHTML=currentImgModalImages.length>1?`<button class="img-nav-btn" onclick="imgNav(-1)">← Prev</button><button class="img-nav-btn" onclick="imgNav(1)">Next →</button>`:'';
  modal.classList.add('show');document.body.style.overflow='hidden';
}
function imgNav(dir){currentImgModalIdx=Math.max(0,Math.min(currentImgModalImages.length-1,currentImgModalIdx+dir));openImgModalWithIdx(currentImgModalIdx);}
function closeImgModal(){document.getElementById('img-modal').classList.remove('show');if(!_tdTrade)document.body.style.overflow='';}

// -
// AI TRADE ANALYSIS
// -
async function analyseThisTrade(){
  if(!_tdTrade)return;const k=getGroqKey();if(!k){toast('Add Groq API key in Settings','error');return;}
  const btn=document.getElementById('td-ai-btn'),resp=document.getElementById('td-ai-resp');
  btn.disabled=true;btn.textContent='⏳ Analysing...';
  const t=_tdTrade;const allTrades=DB.get('trades',[]);const wins=allTrades.filter(x=>x.outcome==='Win');const rules=DB.get('rules',[]);
  const prompt=`You are an elite trading coach. Analyse this trade precisely.\n\nTRADE:\n- Date: ${t.date} | Symbol: ${t.symbol} | Direction: ${t.dir}\n- Entry: ${t.entry} | SL: ${t.sl||'N/A'} | Exit: ${t.exit} | Qty: ${t.qty}\n- P&L: ${(t.pnl||0)>=0?'+':''}$${t.pnl} | Outcome: ${t.outcome} | Grade: ${t.grade||'?'}\n- Setup: ${t.setup||'Not tagged'} | Session: ${t.session||'Not logged'}\n- HTF Bias: ${t.htf||'?'} | Liquidity Target: ${t.liquidity||'?'}\n- Confluence: ${(t.confluence||[]).join(', ')||'None'}\n- Emotion: ${t.emotion||'Not logged'} | Mistake: ${t.mistake||'None'}\n- Rule Adherence: ${t.ruleAdhere||'?'}\n- Thesis: ${t.thesis||'Not provided'}\n\nTRADER RULES: ${rules.join(' | ')||'None set'}\nOVERALL: ${allTrades.length} trades · ${allTrades.length?Math.round(wins.length/allTrades.length*100):0}% WR\n\nProvide:\n1. **Entry Quality** — timing, location, confirmation\n2. **Exit Analysis** — optimal? P&L left on table?\n3. **Confluence Assessment** — sufficient? What was missing?\n4. **Rule Compliance** — based on trader's rules\n5. **Specific Improvement** — one concrete change\nBe direct. Max 200 words.`;
  try{const reply=await groqCall(k,prompt,500);resp.innerHTML=mdToHtml(reply);resp.classList.add('show');btn.textContent='↺ Re-analyse';
    const trades=DB.get('trades',[]);const idx=trades.findIndex(x=>x.id===_tdTrade.id);
    if(idx>-1){trades[idx].aiAnalysis=reply;trades[idx].aiAnalysisDate=todayStr();DB.set('trades',trades);}renderDashboard();}
  catch(e){resp.innerHTML=`<span style="color:var(--red);">Error: ${e.message}</span>`;resp.classList.add('show');btn.textContent='Retry';}
  btn.disabled=false;
}

// -
// SETTINGS
// -
function renderSettings(){
  const items=DB.get('checklist',[]);
  const el=document.getElementById('settings-checklist-preview');
  if(el)el.innerHTML=items.map(i=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-subtle);font-size:13px;"><span><span style="color:var(--text-muted);font-size:11px;margin-right:6px;">[${i.cat}]</span>${i.text}</span><button onclick="removeCheck(${i.id});renderSettings();" style="background:none;border:none;color:var(--text-muted);cursor:pointer;">×</button></div>`).join('')||'<div style="color:var(--text-muted);font-size:13px;">No items yet</div>';
  const rules=DB.get('rules',[]);
  const el2=document.getElementById('settings-rules-preview');
  if(el2)el2.innerHTML=rules.map((r,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-subtle);font-size:13px;"><span>${r}</span><button onclick="removeRule(${i});renderSettings();" style="background:none;border:none;color:var(--text-muted);cursor:pointer;">×</button></div>`).join('')||'<div style="color:var(--text-muted);font-size:13px;">No rules yet</div>';
}

// -
// EXPORT / IMPORT
// -
function exportData(){const data={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k.startsWith('tl_'))data[k]=localStorage.getItem(k);}const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`tradeledger_${todayStr()}.json`;a.click();toast('Data exported!','ok');}
function importData(e){const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>{try{const data=JSON.parse(ev.target.result);Object.keys(data).forEach(k=>localStorage.setItem(k,data[k]));toast('Imported! Refreshing...');setTimeout(()=>location.reload(),1200);}catch{toast('Invalid file','error');}};reader.readAsText(file);}
function clearAllData(){const keys=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k.startsWith('tl_'))keys.push(k);}keys.forEach(k=>localStorage.removeItem(k));toast('All data cleared');setTimeout(()=>location.reload(),1200);}

// -
// CONVERTER
// -
let rateChartInst=null;
async function fetchLiveRate(){
  try{const r=await fetch('https://open.er-api.com/v6/latest/USD');const d=await r.json();
    if(d?.rates?.INR){liveRate=parseFloat(d.rates.INR.toFixed(4));document.getElementById('live-rate-display').textContent='₹'+liveRate.toFixed(2);document.getElementById('rate-status').textContent='Live';document.getElementById('rate-status').style.color='var(--green)';document.getElementById('rate-updated').textContent='Updated: '+new Date().toLocaleTimeString();convertCurrency();renderBulkTable();renderRateChart(liveRate);}else throw new Error('bad response');}
  catch(e){liveRate=83.5;document.getElementById('live-rate-display').textContent='₹'+liveRate.toFixed(2);document.getElementById('rate-status').textContent='Offline';document.getElementById('rate-updated').textContent='Using fallback ₹'+liveRate.toFixed(2);renderRateChart(liveRate);}
}
function setDir(dir){convDir=dir;const u=document.getElementById('dir-usd-inr');const v=document.getElementById('dir-inr-usd');if(dir==='usd-inr'){u.className='btn btn-primary btn-sm';v.className='btn btn-outline btn-sm';}else{v.className='btn btn-primary btn-sm';u.className='btn btn-outline btn-sm';}document.getElementById('conv-from-label').textContent=dir==='usd-inr'?'Amount (USD $)':'Amount (INR ₹)';document.getElementById('conv-to-label').textContent=dir==='usd-inr'?'Result (INR ₹)':'Result (USD $)';document.getElementById('conv-amount').value='';document.getElementById('conv-result').textContent='—';}
function convertCurrency(){const amt=parseFloat(document.getElementById('conv-amount').value);if(!amt||!liveRate){document.getElementById('conv-result').textContent='—';return;}document.getElementById('conv-result').textContent=convDir==='usd-inr'?'₹'+(amt*liveRate).toLocaleString('en-IN',{maximumFractionDigits:2}):'$'+(amt/liveRate).toLocaleString('en-US',{maximumFractionDigits:2});}
function addBulkRow(){const v=parseFloat(document.getElementById('bulk-input').value);if(!v){toast('Enter a USD amount','error');return;}bulkRows.push(v);document.getElementById('bulk-input').value='';renderBulkTable();}
function removeBulkRow(i){bulkRows.splice(i,1);renderBulkTable();}
function clearBulk(){bulkRows=[];renderBulkTable();}
function renderBulkTable(){const body=document.getElementById('bulk-table-body');const foot=document.getElementById('bulk-table-foot');if(!body)return;const rate=liveRate||83.5;if(!bulkRows.length){body.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:16px;">No entries yet</td></tr>';foot.innerHTML='';return;}let tu=0,ti=0;body.innerHTML=bulkRows.map((usd,i)=>{const inr=usd*rate;tu+=usd;ti+=inr;const c=usd>=0?'var(--green)':'var(--red)';return`<tr><td style="color:var(--text-muted);">${i+1}</td><td style="font-family:var(--font-jet);color:${c};">$${usd.toLocaleString('en-US',{minimumFractionDigits:2})}</td><td style="color:var(--text-muted);font-size:11px;">₹${rate.toFixed(2)}</td><td style="font-family:var(--font-jet);font-weight:600;color:${c};">₹${inr.toLocaleString('en-IN',{maximumFractionDigits:0})}</td><td><button onclick="removeBulkRow(${i})" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;">×</button></td></tr>`;}).join('');foot.innerHTML=`<tr><td style="color:var(--text-muted);font-size:11px;">TOTAL</td><td style="font-family:var(--font-jet);font-weight:700;color:${tu>=0?'var(--green)':'var(--red)'};">$${tu.toLocaleString('en-US',{minimumFractionDigits:2})}</td><td></td><td style="font-family:var(--font-jet);font-weight:700;color:${ti>=0?'var(--green)':'var(--red)'};">₹${ti.toLocaleString('en-IN',{maximumFractionDigits:0})}</td><td></td></tr>`;}
function renderRateChart(r){const labels=[],vals=[];for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);labels.push(d.toLocaleDateString('en-US',{month:'short',day:'numeric'}));vals.push(parseFloat((r+(Math.random()-.5)*0.6).toFixed(4)));}vals[vals.length-1]=r;if(rateChartInst)rateChartInst.destroy();const c=document.getElementById('rate-history-chart');if(!c)return;rateChartInst=new Chart(c,{type:'line',data:{labels,datasets:[{data:vals,borderColor:'var(--cyan)',backgroundColor:'rgba(34,211,238,0.07)',fill:true,tension:0.4,pointRadius:4,pointBackgroundColor:'var(--cyan)'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#555555',font:{size:11}},grid:{color:'rgba(255,255,255,0.03)'}},y:{ticks:{color:'#555555',callback:v=>'₹'+v.toFixed(2)},grid:{color:'rgba(255,255,255,0.03)'}}}}});}

// -
// AI SYSTEM
// -
function getGroqKey(){return DB.get('groq_key','')||'';}
function saveGroqKey(k){
  if(!k?.trim()){toast('Enter a valid key','error');return;}
  DB.set('groq_key',k.trim());
  document.getElementById('nav-groq-dot').classList.add('on');
  document.getElementById('nav-groq-label').textContent='Groq Active';
  document.getElementById('sb-groq-pill').classList.add('connected');
  document.getElementById('settings-groq-key').value=k.trim();
  document.getElementById('ais-setup').classList.add('hidden');
  document.getElementById('ais-status').className='connected';
  document.getElementById('status-txt').textContent='Groq Connected';
  updateAIKPIs();toast('Groq connected!','ok');
}
function updateAIKPIs(){
  const trades=DB.get('trades',[]);const wins=trades.filter(t=>t.outcome==='Win'),losses=trades.filter(t=>t.outcome==='Loss');
  const totalPnl=trades.reduce((s,t)=>s+(t.pnl||0),0);const avgWin=wins.length?wins.reduce((s,t)=>s+(t.pnl||0),0)/wins.length:0;const avgLoss=losses.length?Math.abs(losses.reduce((s,t)=>s+(t.pnl||0),0)/losses.length):0;const rr=avgLoss?avgWin/avgLoss:0;
  const s=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  s('lk-pnl',`${totalPnl>=0?'+':''}$${Math.round(totalPnl).toLocaleString()}`);s('lk-pnls',`${trades.length} trades total`);s('lk-wr',trades.length?`${(wins.length/trades.length*100).toFixed(1)}%`:'—');s('lk-wrs',`${wins.length}W · ${losses.length}L`);s('lk-rr',rr?rr.toFixed(2)+'R':'—');s('lk-tr',trades.length);
  const setupMap={};trades.forEach(t=>{const sv=t.setup||'Other';if(!setupMap[sv])setupMap[sv]={pnl:0,count:0};setupMap[sv].pnl+=(t.pnl||0);setupMap[sv].count++;});
  const sk=Object.keys(setupMap).sort((a,b)=>setupMap[b].pnl-setupMap[a].pnl).slice(0,5);const maxP=Math.max(...sk.map(k=>Math.abs(setupMap[k].pnl)),1);
  const seEl=document.getElementById('lk-setups');
  if(seEl)seEl.innerHTML=sk.map(k=>`<div class="sb"><span class="sb-n">${k}</span><div class="sb-t"><div class="sb-f" style="width:${(Math.abs(setupMap[k].pnl)/maxP*100).toFixed(0)}%;background:${setupMap[k].pnl>=0?'var(--accent)':'var(--red)'}"></div></div><span class="sb-v" style="color:${setupMap[k].pnl>=0?'var(--accent)':'var(--red)'};">${setupMap[k].pnl>=0?'+':''}$${Math.round(setupMap[k].pnl).toLocaleString()}</span></div>`).join('')||'<div class="mem-empty">No setups logged</div>';
  const emoMap={};trades.filter(t=>t.emotion).forEach(t=>{if(!emoMap[t.emotion])emoMap[t.emotion]={wins:0,total:0};emoMap[t.emotion].total++;if(t.outcome==='Win')emoMap[t.emotion].wins++;});
  const ek=Object.keys(emoMap).sort((a,b)=>emoMap[b].total-emoMap[a].total).slice(0,5);
  const ePal=['#ffffff','#22d3ee','#fbbf24','#f87171','#a78bfa'];
  const emEl=document.getElementById('lk-emos');
  if(emEl)emEl.innerHTML=ek.map((e,i)=>`<div class="er"><div class="er-dot" style="background:${ePal[i]}"></div><span class="er-n">${e}</span><span class="er-c">${emoMap[e].total}x</span><span class="er-p" style="color:${emoMap[e].wins/emoMap[e].total>=.5?'var(--green)':'var(--red)'};">${Math.round(emoMap[e].wins/emoMap[e].total*100)}%</span></div>`).join('')||'<div class="mem-empty">No emotions logged</div>';
  renderMemorySidebar();
}
function renderMemorySidebar(){const mems=DB.get('memories',[]);const el=document.getElementById('mem-list');if(!el)return;if(!mems.length){el.innerHTML='<div class="mem-empty">No memories yet.</div>';return;}el.innerHTML=mems.slice(-8).reverse().map((m,i)=>`<div class="mem-item"><span class="mem-tag tag-${m.tag}">${m.tag}</span><div style="flex:1;min-width:0;"><div class="mem-text" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${m.title||m.body.slice(0,40)}</div><div class="mem-date">${m.date}</div></div><button class="mem-del" onclick="event.stopPropagation()">×</button></div>`).join('');}

let _isStreaming=false;
function aiOpen(){document.getElementById('ais').classList.add('open');document.body.style.overflow='hidden';const k=getGroqKey();if(k){document.getElementById('ais-setup').classList.add('hidden');document.getElementById('ais-status').className='connected';document.getElementById('status-txt').textContent='Groq Connected';}updateAIKPIs();if(!document.getElementById('ais-msgs').children.length)aiAddMsg('bot','Hello! I\'m your AI trading analyst. I have full access to your journal data. Ask me anything about your performance, psychology, setups, or request a full coaching report.');}
function aiClose(){document.getElementById('ais').classList.remove('open');document.body.style.overflow='';}
function aiClear(){document.getElementById('ais-msgs').innerHTML='';aiAddMsg('bot','Chat cleared. Ready to analyse your trading data.');}
function switchTab(tab,el){document.querySelectorAll('.ais-tab').forEach(t=>t.classList.remove('active'));if(el)el.classList.add('active');const chat=document.getElementById('ais-panel-chat');const mem=document.getElementById('ais-panel-memory');if(tab==='chat'){if(chat)chat.style.display='flex';if(mem)mem.classList.remove('show');}else{if(chat)chat.style.display='none';if(mem){mem.classList.add('show');renderMemoryPanel();}}}
function aiAsk(msg){aiOpen();setTimeout(()=>{document.getElementById('ais-inp').value=msg;aiSend();},150);}
async function aiSend(){
  const inp=document.getElementById('ais-inp');const msg=inp.value.trim();if(!msg)return;const k=getGroqKey();if(!k){document.getElementById('ais-setup').classList.remove('hidden');return;}
  inp.value='';inp.style.height='auto';aiAddMsg('user',msg);_isStreaming=true;document.getElementById('ais-send').disabled=true;
  const trades=DB.get('trades',[]);const wins=trades.filter(t=>t.outcome==='Win'),losses=trades.filter(t=>t.outcome==='Loss');
  const totalPnl=trades.reduce((s,t)=>s+(t.pnl||0),0);const avgWin=wins.length?wins.reduce((s,t)=>s+(t.pnl||0),0)/wins.length:0;const avgLoss=losses.length?Math.abs(losses.reduce((s,t)=>s+(t.pnl||0),0)/losses.length):0;
  const rules=DB.get('rules',[]);const mems=DB.get('memories',[]);
  const mMap={};trades.filter(t=>t.mistake).forEach(t=>{mMap[t.mistake]=(mMap[t.mistake]||0)+1;});const topMistake=Object.keys(mMap).sort((a,b)=>mMap[b]-mMap[a])[0]||'None';
  const setupMap={};trades.forEach(t=>{const sv=t.setup||'Other';if(!setupMap[sv])setupMap[sv]={pnl:0,wins:0,total:0};setupMap[sv].pnl+=(t.pnl||0);setupMap[sv].total++;if(t.outcome==='Win')setupMap[sv].wins++;});
  const bestSetup=Object.keys(setupMap).sort((a,b)=>setupMap[b].pnl-setupMap[a].pnl)[0]||'None';
  const sysPrompt="You are TradeLedger AI, an elite personal trading coach. Full access to journal.\n\nSTATS:\n- P&L: $"+Math.round(totalPnl).toLocaleString()+"\n- Trades: "+trades.length+" | Win Rate: "+(trades.length?(wins.length/trades.length*100).toFixed(1):0)+"%\n- Wins: "+wins.length+" Losses: "+losses.length+"\n- Avg Win: $"+avgWin.toFixed(0)+" Avg Loss: $"+avgLoss.toFixed(0)+" R:R: "+(avgLoss?(avgWin/avgLoss).toFixed(2):0)+"\n- Best Setup: "+bestSetup+" | Top Mistake: "+topMistake+"\n- Rules: "+rules.join("; ")+"\n- Memories: "+mems.slice(-3).map(function(m){return m.title+": "+m.body.slice(0,50);}).join(" | ")+"\n\nRECENT TRADES:\n"+trades.slice(-5).map(function(t){return t.date+" "+t.symbol+" "+t.dir+" $"+t.pnl+" "+t.outcome+(t.mistake?" "+t.mistake:"");}).join("\n")+"\n\nBe sharp, data-driven, use markdown, reference actual data.";
  const msgs=[];document.querySelectorAll('.am').forEach(el=>{const role=el.classList.contains('user')?'user':'assistant';const bub=el.querySelector('.am-bub');if(bub)msgs.push({role:role,content:bub.textContent||''});});msgs.push({role:'user',content:msg});
  const thinkId='think-'+Date.now();aiAddThinking(thinkId);
  try{const reply=await groqCall(k,null,800,sysPrompt,msgs.slice(-12));const el=document.getElementById(thinkId);if(el)el.remove();aiAddMsg('bot',reply);}
  catch(e){const el=document.getElementById(thinkId);if(el)el.remove();aiAddMsg('bot',`Error: ${e.message}. Check your Groq API key in Settings.`);}
  _isStreaming=false;document.getElementById('ais-send').disabled=false;
}
function aiAddMsg(role,content){const msgs=document.getElementById('ais-msgs');const el=document.createElement('div');el.className='am '+role;const time=new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});el.innerHTML=`<div class="am-av">${role==='bot'?'AI':'↑'}</div><div class="am-body"><div class="am-meta">${role==='bot'?'TradeLedger AI':'You'} · ${time}</div><div class="am-bub">${role==='bot'?mdToHtml(content):content}</div></div>`;msgs.appendChild(el);msgs.scrollTop=msgs.scrollHeight;}
function aiAddThinking(id){const msgs=document.getElementById('ais-msgs');const el=document.createElement('div');el.className='am bot';el.id=id;el.innerHTML=`<div class="am-av">AI</div><div class="am-body"><div class="am-meta">Thinking...</div><div class="am-bub"><div class="thinking-row"><div class="dots"><span></span><span></span><span></span></div><span style="color:var(--text-muted);font-size:12px;margin-left:8px;">Analysing your trading data...</span></div></div></div>`;msgs.appendChild(el);msgs.scrollTop=msgs.scrollHeight;}
async function groqCall(key,prompt,maxTokens=600,systemPrompt,messages){const k=key||getGroqKey();if(!k)throw new Error('No API key');const msgs=messages||[{role:'user',content:prompt}];const body={model:'llama-3.3-70b-versatile',messages:systemPrompt?[{role:'system',content:systemPrompt},...msgs]:msgs,max_tokens:maxTokens,temperature:0.7};const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+k},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error?.message||`API error ${r.status}`);return data.choices[0].message.content;}

// -
// MEMORY
// -
function saveMemory(){const tag=document.getElementById('mem-tag-sel').value;const title=document.getElementById('mem-title-inp').value.trim();const body=document.getElementById('mem-body-inp').value.trim();if(!body){toast('Enter some content','error');return;}const mems=DB.get('memories',[]);mems.push({tag,title:title||body.slice(0,40),body,date:todayStr()});DB.set('memories',mems);document.getElementById('mem-title-inp').value='';document.getElementById('mem-body-inp').value='';renderMemoryPanel();renderMemorySidebar();toast('Saved!','ok');}
function renderMemoryPanel(){const mems=DB.get('memories',[]).slice().reverse();const el=document.getElementById('mem-grid');if(!el)return;if(!mems.length){el.innerHTML='<div class="mem-empty-state"><div style="font-size:32px;margin-bottom:12px;">💭</div><div>No memories saved yet.</div></div>';return;}el.innerHTML=mems.map((m,i)=>`<div class="mem-card"><span class="mem-card-tag tag-${m.tag}">${m.tag}</span><div style="flex:1;"><div class="mem-card-title">${m.title}</div><div style="font-size:12px;color:var(--text-secondary);line-height:1.5;margin:4px 0;">${m.body.slice(0,120)}${m.body.length>120?'...':''}</div><div class="mem-card-date">${m.date}</div></div><button class="mem-card-del" onclick="delMemory(${i})">×</button></div>`).join('');}
function delMemory(i){const m=DB.get('memories',[]).slice().reverse();m.splice(i,1);DB.set('memories',m.reverse());renderMemoryPanel();renderMemorySidebar();}

// -
// VOICE
// -
let _micActive=false,_voiceOut=false,_recognition=null,_synth=window.speechSynthesis;
function toggleMic(){if(!('webkitSpeechRecognition' in window||'SpeechRecognition' in window)){toast('Voice not supported','error');return;}if(!_micActive){_recognition=new(window.SpeechRecognition||window.webkitSpeechRecognition)();_recognition.continuous=false;_recognition.interimResults=false;_recognition.lang='en-US';_recognition.onresult=e=>{const t=e.results[0][0].transcript;document.getElementById('ais-inp').value=t;};_recognition.onend=()=>stopMic();_recognition.start();_micActive=true;document.getElementById('voice-mic-btn').style.borderColor='var(--green)';document.getElementById('voice-mic-btn').style.color='var(--green)';document.getElementById('voice-indicator').style.background='var(--green)';document.getElementById('voice-status').textContent='Listening...';}else stopMic();}
function stopMic(){_micActive=false;if(_recognition)_recognition.stop();document.getElementById('voice-mic-btn').style.borderColor='';document.getElementById('voice-mic-btn').style.color='';document.getElementById('voice-indicator').style.background='var(--text-dim)';document.getElementById('voice-status').textContent='Mic off';}
function toggleVoiceOut(){_voiceOut=!_voiceOut;document.getElementById('voice-out-btn').style.color=_voiceOut?'var(--green)':'var(--accent)';toast(_voiceOut?'AI voice enabled':'AI voice off');}
function stopSpeaking(){if(_synth)_synth.cancel();document.getElementById('stop-speak-btn').classList.remove('show');}

// -
// MARKDOWN
// -
function mdToHtml(md){if(!md)return '';return md.replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/^### (.+)$/gm,'<h3 style="font-size:13px;font-weight:600;color:var(--accent);margin:12px 0 6px;">$1</h3>').replace(/^## (.+)$/gm,'<h3 style="font-size:14px;font-weight:600;color:var(--accent);margin:12px 0 6px;">$1</h3>').replace(/^# (.+)$/gm,'<h3 style="font-size:15px;font-weight:600;color:var(--accent);margin:12px 0 6px;">$1</h3>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/`(.+?)`/g,'<code>$1</code>').replace(/^> (.+)$/gm,'<blockquote style="border-left:3px solid var(--accent);padding:8px 13px;margin:8px 0;background:var(--accent-dim);border-radius:0 8px 8px 0;">$1</blockquote>').replace(/^---$/gm,'<hr style="border:none;border-top:1px solid var(--border-subtle);margin:12px 0;">').replace(/^[-*] (.+)$/gm,'<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>\n?)+/g,'<ul style="padding-left:18px;margin:8px 0;">$&</ul>').replace(/^\d+\. (.+)$/gm,'<li>$1</li>').replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>');}

// -
// START
// -
init();