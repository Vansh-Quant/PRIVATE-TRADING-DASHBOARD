// ═══════════════════════════════════════════════════
// LIVE PAPER TRADING — REAL MARKET DATA, VIRTUAL MONEY
// ═══════════════════════════════════════════════════
let _simWS=null,_simSymbol='',_simLastPrice=0,_simLastTick=0,_simReconnect=null;
let _simChart=null,_simCandleSeries=null,_simChartResize=null,_simChartKey='',_simBars=[];
let _simEntryLine=null,_simSlLine=null,_simTpLine=null,_simDrag=null;

function getMarketKey(){return DB.get('market_key','')||'';}
function saveMarketKey(k){
  DB.set('market_key',(k||'').trim());
  const el=document.getElementById('settings-market-key');if(el)el.value=(k||'').trim();
  toast('BiQuote does not require an API key. Saved for fallback use.','ok');
  if(document.getElementById('page-simulator')?.classList.contains('active'))connectLiveMarket();
}
function simAccountId(){return document.getElementById('sim-account')?.value||getAccounts()[0]?.id;}
function simState(id){const all=DB.get('sim_accounts',{});const a=getAccounts().find(x=>x.id===id);if(!all[id]){all[id]={balance:Number(a?.size)||0,realized:0};DB.set('sim_accounts',all);}return all[id];}
function saveSimState(id,state){const all=DB.get('sim_accounts',{});all[id]=state;DB.set('sim_accounts',all);}
function simPositions(id){return DB.get('sim_positions',[]).filter(p=>p.accountId===id);}
function simHistory(id){return DB.get('sim_history',[]).filter(h=>h.accountId===id);}
function simPointSize(){const symbol=(document.getElementById('sim-symbol')?.value||'').toUpperCase().replace('/','');return /JPY/.test(symbol)?0.01:/XAU|GOLD/.test(symbol)?0.1:/US30|NAS|GER|DAX|SPX/.test(symbol)?1:0.0001;}
function normalizedTDSymbol(v){let s=(v||'EUR/USD').trim().toUpperCase();if(/^[A-Z]{6}$/.test(s))s=s.slice(0,3)+'/'+s.slice(3);return s;}
function simSymbolApi(v){return normalizedTDSymbol(v).replace('/','');}
function fmtPrice(v){if(v===null||v===undefined||!Number.isFinite(Number(v)))return '—';const p=simPointSize();return Number(v).toFixed(p>=1?2:p>=0.01?3:5);}
function simBidAsk(){const px=_simLastPrice||0,spreadPts=Math.max(0,Number(document.getElementById('sim-spread')?.value)||0),half=spreadPts*simPointSize()/2;return {bid:px-half,ask:px+half};}
function renderSimQuote(){
  const {bid,ask}=simBidAsk();
  [['sim-buy-quote',ask],['sim-sell-quote',bid],['sim-ask-display',ask],['sim-bid-display',bid],['sim-live-price',_simLastPrice]].forEach(([id,v])=>{const e=document.getElementById(id);if(e)e.textContent=v?fmtPrice(v):'—';});
}
function setMarketStatus(text,ok=false){
  const e=document.getElementById('sim-status');if(e){e.textContent=text;e.className='tag '+(ok?'tag-win':'tag-be');}
  const s=document.getElementById('settings-market-status');if(s&&ok){s.textContent='CONNECTED';s.className='tag tag-win';}
}
function setChartStatus(text,ok=false){const e=document.getElementById('sim-chart-status');if(e){e.textContent=text;e.className='tag '+(ok?'tag-win':'tag-be');}}
function disconnectLiveMarket(){if(_simWS){try{_simWS.stop?.();_simWS.close?.();}catch{} _simWS=null;}if(_simReconnect){clearTimeout(_simReconnect);_simReconnect=null;}}

async function connectLiveMarket(){
  const sym=simSymbolApi(document.getElementById('sim-symbol')?.value||'EUR/USD');
  if(_simWS&&_simSymbol===sym)return;
  disconnectLiveMarket();_simSymbol=sym;setMarketStatus('CONNECTING');
  if(!window.signalR){setMarketStatus('NO FEED LIBRARY');return;}
  try{
    const connection=new signalR.HubConnectionBuilder().withUrl('https://biquote.io/hubs/tick').withAutomaticReconnect([0,1000,3000,5000,10000]).build();
    connection.on('ReceiveTick',tick=>{
      if(!tick||String(tick.symbol).toUpperCase()!==sym)return;
      const px=Number(tick.mid||((Number(tick.bid)+Number(tick.ask))/2));if(!Number.isFinite(px))return;
      _simLastPrice=px;_simLastTick=Date.now();
      const t=document.getElementById('sim-live-time');if(t)t.textContent=new Date().toLocaleTimeString();
      setMarketStatus('LIVE',true);renderSimQuote();updateLiveCandle(px);checkSimStops();renderSimulator();
    });
    connection.onreconnecting(()=>setMarketStatus('RECONNECTING'));
    connection.onreconnected(async()=>{setMarketStatus('LIVE',true);try{await connection.invoke('Subscribe',[sym]);const tick=await connection.invoke('GetLatestTick',sym);applyLiveTick(tick);}catch{}});
    connection.onclose(()=>{if(_simSymbol===sym){setMarketStatus('RECONNECTING');_simReconnect=setTimeout(()=>connectLiveMarket(),3000);}});
    await connection.start();
    await connection.invoke('Subscribe',[sym]);
    const tick=await connection.invoke('GetLatestTick',sym);applyLiveTick(tick);
    _simWS=connection;setMarketStatus('LIVE',true);
  }catch(e){setMarketStatus('FEED ERROR');_simReconnect=setTimeout(()=>connectLiveMarket(),5000);}
}
function applyLiveTick(tick){if(!tick)return;const px=Number(tick.mid||((Number(tick.bid)+Number(tick.ask))/2));if(!Number.isFinite(px))return;_simLastPrice=px;_simLastTick=Date.now();renderSimQuote();updateLiveCandle(px);}
async function fetchLivePaperQuote(){
  const sym=simSymbolApi(document.getElementById('sim-symbol')?.value||'EUR/USD');
  try{const r=await fetch(`https://biquote.io/api/${encodeURIComponent(sym)}?allowStale=false`,{cache:'no-store'});const d=await r.json();if(d?.mid){applyLiveTick(d);setMarketStatus('LIVE',true);}}
  catch{if(!_simLastPrice)setMarketStatus('WAITING');}
}

async function loadSimChart(){
  const host=document.getElementById('sim-chart');if(!host||!window.LightweightCharts)return;
  const symbol=simSymbolApi(document.getElementById('sim-symbol')?.value||'EUR/USD');
  const interval=document.getElementById('sim-tv-interval')?.value||'15';
  const apiInterval=({'1':'1m','5':'5m','15':'15m','30':'30m','60':'1h','240':'4h','D':'1d'})[interval]||'15m';
  const key=`${symbol}|${interval}`;
  if(_simChartKey===key&&_simCandleSeries)return;
  _simChartKey=key;_simBars=[];clearChartLines();
  const loading=document.getElementById('sim-chart-loading');if(loading){loading.style.display='flex';loading.textContent='Loading market history…';}
  setChartStatus('LOADING');
  if(_simChart){try{_simChart.remove();}catch{}}
  _simChart=LightweightCharts.createChart(host,{layout:{background:{type:'solid',color:'#000000'},textColor:'#777'},grid:{vertLines:{color:'rgba(255,255,255,.035)'},horzLines:{color:'rgba(255,255,255,.035)'}},crosshair:{mode:LightweightCharts.CrosshairMode.Normal},rightPriceScale:{borderColor:'rgba(255,255,255,.08)'},timeScale:{borderColor:'rgba(255,255,255,.08)',timeVisible:true,secondsVisible:false},handleScroll:true,handleScale:true});
  _simCandleSeries=_simChart.addCandlestickSeries({upColor:'#d9f99d',downColor:'#f87171',borderVisible:false,wickUpColor:'#d9f99d',wickDownColor:'#f87171'});
  if(_simChartResize)window.removeEventListener('resize',_simChartResize);
  _simChartResize=()=>{if(_simChart&&host.clientWidth&&host.clientHeight)_simChart.applyOptions({width:host.clientWidth,height:host.clientHeight});};
  window.addEventListener('resize',_simChartResize);_simChartResize();
  try{
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),9000);
    const url=`https://biquote.io/api/${encodeURIComponent(symbol)}/ohlc?interval=${encodeURIComponent(apiInterval)}&limit=1000`;
    const r=await fetch(url,{cache:'no-store',signal:controller.signal});clearTimeout(timer);if(!r.ok){let msg='HTTP '+r.status;try{const er=await r.json();if(er?.message)msg+=': '+er.message;}catch{}throw new Error(msg);}
    const d=await r.json();
    if(!d || !Array.isArray(d.bars))throw new Error('Invalid OHLC response');
    const bars=(d.bars||[]).map(b=>({time:Math.floor(new Date(b.openTime).getTime()/1000),open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close)})).filter(b=>Number.isFinite(b.time)&&[b.open,b.high,b.low,b.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time);
    const dedup=[];for(const b of bars){if(!dedup.length||dedup[dedup.length-1].time!==b.time)dedup.push(b);else dedup[dedup.length-1]=b;}
    _simBars=dedup;_simCandleSeries.setData(_simBars);_simChart.timeScale().fitContent();
    if(loading)loading.style.display='none';setChartStatus('LIVE',true);
    if(_simLastPrice)updateLiveCandle(_simLastPrice);
    bindChartTrading();
  }catch(e){
    if(loading){loading.style.display='flex';loading.textContent='Historical candles failed. Retrying…';}
    setChartStatus('HISTORY ERROR');
    setTimeout(()=>{if(_simChartKey===key)loadSimChart();},5000);
  }
}
function candleBucket(ts,interval){const mins=({'1':1,'5':5,'15':15,'30':30,'60':60,'240':240,'D':1440})[interval]||15;const sec=mins*60;return Math.floor(ts/sec)*sec;}
function updateLiveCandle(px){
  if(!_simCandleSeries||!px)return;const interval=document.getElementById('sim-tv-interval')?.value||'15';const t=candleBucket(Math.floor(Date.now()/1000),interval);let last=_simBars[_simBars.length-1];
  if(!last||t>last.time){last={time:t,open:px,high:px,low:px,close:px};_simBars.push(last);if(_simBars.length>700)_simBars.shift();}
  else if(t===last.time){last.high=Math.max(last.high,px);last.low=Math.min(last.low,px);last.close=px;}
  else{return;}
  _simCandleSeries.update({...last});
}
function clearChartLines(){[_simEntryLine,_simSlLine,_simTpLine].forEach(x=>{try{if(x&&_simCandleSeries)_simCandleSeries.removePriceLine(x);}catch{}});_simEntryLine=_simSlLine=_simTpLine=null;}
function chartLine(price,title,color){if(!_simCandleSeries||!price)return null;return _simCandleSeries.createPriceLine({price,title,color,lineWidth:1,lineStyle:LightweightCharts.LineStyle.Dashed,axisLabelVisible:true,titleLabelVisible:true});}
function syncChartLines(){
  clearChartLines();const pos=simPositions(simAccountId())[0];if(!pos)return;
  _simEntryLine=chartLine(pos.entry,'ENTRY','#9ca3af');_simSlLine=chartLine(pos.sl,'SL','#f87171');_simTpLine=chartLine(pos.tp,'TP','#d9f99d');
  renderChartDragHandles(pos);
}
function renderChartDragHandles(pos){
  const wrap=document.getElementById('sim-chart-wrap');if(!wrap||!_simCandleSeries)return;
  wrap.querySelectorAll('.sim-drag-line').forEach(e=>e.remove());
  [['sl',pos.sl,'SL','#f87171'],['tp',pos.tp,'TP','#d9f99d']].forEach(([kind,price,label,color])=>{if(!price)return;const line=document.createElement('button');line.type='button';line.className='sim-drag-line';line.dataset.kind=kind;line.textContent=label;line.style.cssText=`position:absolute;right:8px;transform:translateY(-50%);z-index:5;border:1px solid ${color};background:#050505;color:${color};font:10px ui-monospace;padding:4px 7px;border-radius:4px;cursor:ns-resize;`;
    const y=_simCandleSeries.priceToCoordinate(price);if(y==null)return;line.style.top=y+'px';line.addEventListener('pointerdown',e=>{e.preventDefault();line.setPointerCapture(e.pointerId);_simDrag={kind,posId:pos.id};});line.addEventListener('pointermove',e=>{if(!_simDrag||_simDrag.posId!==pos.id)return;const rect=wrap.getBoundingClientRect();const y2=Math.max(0,Math.min(rect.height,e.clientY-rect.top));const price2=_simCandleSeries.coordinateToPrice(y2);if(!Number.isFinite(price2))return;const all=DB.get('sim_positions',[]),p=all.find(x=>x.id===pos.id);if(!p)return;p[_simDrag.kind]=Number(price2);DB.set('sim_positions',all);line.style.top=y2+'px';if(_simDrag.kind==='sl'&&_simSlLine)_simSlLine.applyOptions({price:Number(price2)});if(_simDrag.kind==='tp'&&_simTpLine)_simTpLine.applyOptions({price:Number(price2)});updatePositionSizePreview();renderSimulator();});line.addEventListener('pointerup',()=>{_simDrag=null;syncChartLines();});wrap.appendChild(line);});
}
function bindChartTrading(){
  const wrap=document.getElementById('sim-chart-wrap');if(!wrap||wrap.dataset.bound)return;wrap.dataset.bound='1';
  const controls=document.createElement('div');controls.style.cssText='position:absolute;left:10px;top:10px;z-index:4;display:flex;gap:6px;';controls.innerHTML='<button type="button" class="btn btn-ghost btn-xs" data-chart-order="Buy">BUY</button><button type="button" class="btn btn-ghost btn-xs" data-chart-order="Sell">SELL</button><button type="button" class="btn btn-ghost btn-xs" data-chart-tool="sl">SET SL</button><button type="button" class="btn btn-ghost btn-xs" data-chart-tool="tp">SET TP</button>';wrap.appendChild(controls);
  controls.querySelectorAll('[data-chart-order]').forEach(b=>b.addEventListener('click',()=>placeSimOrder(b.dataset.chartOrder)));
  controls.querySelectorAll('[data-chart-tool]').forEach(b=>b.addEventListener('click',()=>{wrap.dataset.chartTool=b.dataset.chartTool;controls.querySelectorAll('[data-chart-tool]').forEach(x=>x.classList.remove('active'));b.classList.add('active');}));
  wrap.addEventListener('click',e=>{if(e.target.closest('button'))return;const tool=wrap.dataset.chartTool;if(!tool||!_simCandleSeries)return;const rect=wrap.getBoundingClientRect();const y=e.clientY-rect.top;const price=_simCandleSeries.coordinateToPrice(y);if(!Number.isFinite(price))return;const id=simAccountId(),all=DB.get('sim_positions',[]),pos=all.find(x=>x.accountId===id);if(!pos){toast('Open a paper position first','error');wrap.dataset.chartTool='';return;}pos[tool]=Number(price);DB.set('sim_positions',all);wrap.dataset.chartTool='';controls.querySelectorAll('[data-chart-tool]').forEach(x=>x.classList.remove('active'));syncChartLines();renderSimulator();});
}
function simSlip(){const max=Math.max(0,Number(document.getElementById('sim-slip')?.value)||0),mode=document.getElementById('sim-slip-mode')?.value||'zero';if(mode==='zero'||!max)return 0;return mode==='fixed'?max:Math.random()*max;}
function positionSizeFromMode(side,entry,sl){
  const mode=document.getElementById('sim-size-mode')?.value||'lots';const st=simState(simAccountId());const contract=Number(document.getElementById('sim-contract').value)||100000;const balance=Math.max(0,Number(st.balance)||0);const lev=Number(document.getElementById('sim-leverage').value)||100;
  if(mode==='lots')return Math.max(0,Number(document.getElementById('sim-qty').value)||0);
  const input=Math.max(0,Number(document.getElementById('sim-size-value').value)||0);
  if(mode==='balance_pct')return entry>0?((balance*input/100)/(entry*contract)):0;
  const riskCash=mode==='risk_pct'?balance*input/100:input;
  if(!sl||Math.abs(entry-sl)<=0)return 0;
  return riskCash/(Math.abs(entry-sl)*contract);
}
function updatePositionSizePreview(){
  const mode=document.getElementById('sim-size-mode')?.value||'lots';const label=document.getElementById('sim-size-value-label');const input=document.getElementById('sim-size-value');const sl=document.getElementById('sim-sl');
  const labels={lots:'Lots',balance_pct:'% of balance',risk_pct:'Risk %',risk_cash:'Risk $'};if(label)label.textContent=labels[mode]||'Lots';
  if(input){input.style.display=mode==='lots'?'none':'';input.placeholder=mode==='balance_pct'?'e.g. 10':mode==='risk_pct'?'e.g. 1':'e.g. 50';}const lots=document.getElementById('sim-qty');if(lots)lots.style.display=mode==='lots'?'':'none';
  const preview=document.getElementById('sim-size-preview');if(!preview)return;const entry=simBidAsk().ask||_simLastPrice;const qty=positionSizeFromMode('Buy',entry,Number(sl?.value)||0);preview.textContent=qty?`${qty.toFixed(2)} lots · ${(qty*(Number(document.getElementById('sim-contract')?.value)||100000)).toLocaleString(undefined,{maximumFractionDigits:0})} units`:(mode==='lots'?`${Number(document.getElementById('sim-qty')?.value||0).toFixed(2)} lots`:mode.includes('risk')?'Set SL to calculate':'—');
}
function placeSimOrder(side){
  const id=simAccountId();if(!id||!_simLastPrice){toast('Waiting for live market data','error');return;}
  const st=simState(id),{bid,ask}=simBidAsk(),requested=side==='Buy'?ask:bid;if(!requested){toast('No live quote','error');return;}
  const point=simPointSize(),slipPts=simSlip(),slip=slipPts*point,executed=side==='Buy'?ask+slip:bid-slip;const sl=Number(document.getElementById('sim-sl').value)||null;
  const qty=positionSizeFromMode(side,executed,sl);if(qty<=0){toast('Invalid position size. For risk sizing, set a valid SL.','error');return;}
  const contract=Number(document.getElementById('sim-contract').value)||100000,lev=Number(document.getElementById('sim-leverage').value)||100,margin=Math.abs(executed*qty*contract)/lev;
  if(margin>simFreeMargin(id)){toast('Not enough free margin','error');return;}
  const pos={id:'pos-'+Date.now(),accountId:id,symbol:normalizedTDSymbol(document.getElementById('sim-symbol').value||'EUR/USD'),side,qty,entry:executed,requested,slippage:executed-requested,slippagePoints:slipPts,sl,tp:Number(document.getElementById('sim-tp').value)||null,contract,leverage:lev,margin,openedAt:new Date().toISOString()};
  const arr=DB.get('sim_positions',[]);arr.push(pos);DB.set('sim_positions',arr);const comm=Number(document.getElementById('sim-commission').value)||0;st.balance-=comm*qty;saveSimState(id,st);
  simAddHistory({accountId:id,posId:pos.id,time:new Date().toISOString(),symbol:pos.symbol,side,qty,requested,executed,entry:executed,slippage:pos.slippagePoints,realized:0,commission:comm*qty});
  renderSimulator();syncChartLines();toast(`${side} ${qty.toFixed(2)} ${pos.symbol} filled @ ${fmtPrice(executed)}`,'ok');
}
function simFreeMargin(id){const positions=simPositions(id),equity=simEquity(id),used=positions.reduce((s,p)=>s+p.margin,0);return equity-used;}
function simUnrealized(id){const {bid,ask}=simBidAsk();return simPositions(id).reduce((sum,p)=>{const mark=p.side==='Buy'?bid:ask;return sum+(p.side==='Buy'?(mark-p.entry):(p.entry-mark))*p.qty*p.contract;},0);}
function simEquity(id){return simState(id).balance+simUnrealized(id);}
function simAddHistory(h){const arr=DB.get('sim_history',[]);arr.push({...h,id:'hist-'+Date.now()+'-'+Math.random().toString(36).slice(2)});DB.set('sim_history',arr);}
function checkSimStops(){if(!_simLastPrice)return;const positions=simPositions(simAccountId());positions.forEach(p=>{if(p.side==='Buy'&&((p.sl&&_simLastPrice<=p.sl)||(p.tp&&_simLastPrice>=p.tp)))closeSimPosition(p.id,true);if(p.side==='Sell'&&((p.sl&&_simLastPrice>=p.sl)||(p.tp&&_simLastPrice<=p.tp)))closeSimPosition(p.id,true);});}
function closeSimPosition(posId,fromStop=false){
  const all=DB.get('sim_positions',[]),p=all.find(x=>x.id===posId);if(!p||!_simLastPrice)return;const {bid,ask}=simBidAsk(),mark=p.side==='Buy'?bid:ask,point=simPointSize(),sp=simSlip(),slip=sp*point,exec=p.side==='Buy'?mark-slip:mark+slip;
  const gross=p.side==='Buy'?(exec-p.entry):(p.entry-exec),pnl=gross*p.qty*p.contract,comm=Number(document.getElementById('sim-commission').value)||0,total=pnl-comm*p.qty,st=simState(p.accountId);st.balance+=total;st.realized=(st.realized||0)+total;saveSimState(p.accountId,st);
  DB.set('sim_positions',all.filter(x=>x.id!==posId));simAddHistory({accountId:p.accountId,posId:p.id,time:new Date().toISOString(),symbol:p.symbol,side:p.side==='Buy'?'Sell':'Buy',qty:p.qty,requested:mark,executed:exec,slippage:p.side==='Buy'?mark-exec:exec-mark,realized:total,commission:comm*p.qty,entry:p.entry,reason:fromStop?'SL/TP':'Manual'});renderSimulator();syncChartLines();toast(`Position closed · ${total>=0?'+':''}$${total.toFixed(2)}`,'ok');
}
function logSimHistoryToJournal(hid){const arr=DB.get('sim_history',[]),h=arr.find(x=>x.id===hid);if(!h||h.realized===0){toast('Only closed executions can be journaled','error');return;}const pos=DB.get('sim_history',[]).find(x=>x.posId===h.posId&&x.entry);const entry=pos?.entry||h.requested,exit=h.executed,dir=h.side==='Sell'?'Long':'Short';const trades=DB.get('trades',[]);trades.push({id:Date.now(),date:todayStr(),symbol:h.symbol,setup:'Paper Trading',session:'',dir,entry,exit,sl:0,qty:h.qty,pnl:Number(h.realized.toFixed(2)),rr:null,outcome:h.realized>0?'Win':h.realized<0?'Loss':'Breakeven',htf:'',liquidity:'',thesis:'',confluence:[],emotion:'',execQuality:['Live market data','Paper execution'],mistake:'',ruleAdhere:'',notes:'Logged from live-data paper trading terminal',reflection:'',images:[],grade:'',loggedAt:new Date().toISOString(),accountId:h.accountId});DB.set('trades',trades);h.journalLogged=true;DB.set('sim_history',arr);renderTradeLog();renderDashboard();renderSimulator();toast('Paper trade added to journal','ok');}
function resetSimulatorAccount(){const id=simAccountId();if(!id)return;if(!confirm('Reset this paper account balance and clear its positions/history?'))return;const a=getAccounts().find(x=>x.id===id);saveSimState(id,{balance:Number(a?.size)||0,realized:0});DB.set('sim_positions',DB.get('sim_positions',[]).filter(p=>p.accountId!==id));DB.set('sim_history',DB.get('sim_history',[]).filter(h=>h.accountId!==id));renderSimulator();syncChartLines();toast('Paper account reset','ok');}
function loadSimTradingView(){loadSimChart();}
function renderSimulator(){syncAccountSelectors();const id=simAccountId();if(!id)return;const st=simState(id),pos=simPositions(id),hist=simHistory(id),eq=simEquity(id),un=simUnrealized(id),fm=simFreeMargin(id);const set=(x,v)=>{const e=document.getElementById(x);if(e)e.textContent=v;};set('sim-balance','$'+st.balance.toFixed(2));set('sim-equity','$'+eq.toFixed(2));set('sim-unrealized',(un>=0?'+':'')+'$'+un.toFixed(2));set('sim-free-margin','$'+fm.toFixed(2));renderSimQuote();updatePositionSizePreview();const pe=document.getElementById('sim-positions');if(pe)pe.innerHTML=pos.length?pos.map(p=>{const {bid,ask}=simBidAsk(),mark=p.side==='Buy'?bid:ask,u=(p.side==='Buy'?(mark-p.entry):(p.entry-mark))*p.qty*p.contract;return `<tr><td>${p.symbol}</td><td style="color:${p.side==='Buy'?'var(--green)':'var(--red)'}">${p.side}</td><td>${p.qty.toFixed(2)}</td><td>${fmtPrice(p.entry)}</td><td>${fmtPrice(mark)}</td><td>${p.sl?fmtPrice(p.sl):'—'}</td><td>${p.tp?fmtPrice(p.tp):'—'}</td><td style="color:${u>=0?'var(--green)':'var(--red)'}">${u>=0?'+':''}$${u.toFixed(2)}</td><td>$${p.margin.toFixed(2)}</td><td><button class="btn btn-danger btn-xs" onclick="closeSimPosition('${p.id}')">Close</button></td></tr>`}).join(''):'<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:24px;">No open positions</td></tr>';const he=document.getElementById('sim-history');if(he)he.innerHTML=hist.slice().reverse().map(h=>`<tr><td>${new Date(h.time).toLocaleTimeString()}</td><td>${h.symbol}</td><td>${h.side}</td><td>${Number(h.qty).toFixed(2)}</td><td>${fmtPrice(h.requested)}</td><td>${fmtPrice(h.executed)}</td><td>${Number(h.slippage||0).toFixed(2)} pts</td><td style="color:${h.realized>=0?'var(--green)':'var(--red)'}">${h.realized?(h.realized>=0?'+':'')+'$'+Number(h.realized).toFixed(2):'—'}</td><td>${h.realized!==0?(h.journalLogged?'Logged':`<button class="btn btn-ghost btn-xs" onclick="logSimHistoryToJournal('${h.id}')">Log</button>`):'Open'}</td></tr>`).join('')||'<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:24px;">No executions yet</td></tr>';if(_simCandleSeries)syncChartLines();}
