/* Paper-Trader v3 — app.js */
(function(){
  const $ = (id)=> document.getElementById(id);
  const fmtEUR = new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'});
  const state = {
    prices:{kraken:null, coinbase:null, bitstamp:null},
    lastUpdate: null,
    refresh: 5,
    feesMode: 'auto',
    fees: { kraken:0.26, coinbase:0.40, bitstamp:0.40 }, // % taker
    portfolio: [], // array of positions
    selectedId: null,
    newsEnabled: false,
  };
  const KEY='pt_v3_state';

  function load(){
    try{ const j = JSON.parse(localStorage.getItem(KEY)); if(j){ Object.assign(state, j); } }catch(e){}
  }
  function save(){ localStorage.setItem(KEY, JSON.stringify(state)); }

  function setText(id, text){ const el=$(id); if(el) el.textContent=text; }
  function setDot(ex, ok){
    const dot = $('dot-'+ex); const st=$('st-'+ex);
    if(!dot||!st) return;
    dot.classList.remove('ok','bad');
    dot.classList.add(ok? 'ok':'bad');
    st.textContent = ok? 'en ligne' : 'hors-ligne';
  }
  function mkt(ex){ return state.prices[ex] || 0; }

  // Live prices (public endpoints)
  async function getKraken(){
    const r = await fetch('https://api.kraken.com/0/public/Ticker?pair=XXBTZEUR',{cache:'no-store'});
    if(!r.ok) throw new Error('http'); const j = await r.json();
    const p = Number(j?.result?.XXBTZEUR?.c?.[0]); if(!isFinite(p)) throw new Error('nop'); return p;
  }
  async function getCoinbase(){
    const r = await fetch('https://api.coinbase.com/v2/prices/BTC-EUR/spot',{cache:'no-store'});
    if(!r.ok) throw new Error('http'); const j = await r.json();
    const p = Number(j?.data?.amount); if(!isFinite(p)) throw new Error('nop'); return p;
  }
  async function getBitstamp(){
    const r = await fetch('https://www.bitstamp.net/api/v2/ticker/btceur/',{cache:'no-store'});
    if(!r.ok) throw new Error('http'); const j = await r.json();
    const p = Number(j?.last); if(!isFinite(p)) throw new Error('nop'); return p;
  }

  async function tick(){
    const tasks = [
      getKraken().then(p=>{state.prices.kraken=p; setText('p-kraken', fmtEUR.format(p)); setDot('kraken', true)}).catch(()=>setDot('kraken', false)),
      getCoinbase().then(p=>{state.prices.coinbase=p; setText('p-coinbase', fmtEUR.format(p)); setDot('coinbase', true)}).catch(()=>setDot('coinbase', false)),
      getBitstamp().then(p=>{state.prices.bitstamp=p; setText('p-bitstamp', fmtEUR.format(p)); setDot('bitstamp', true)}).catch(()=>setDot('bitstamp', false)),
    ];
    await Promise.allSettled(tasks);
    state.lastUpdate = Date.now();
    setText('last-update','Dernière mise à jour : '+new Date(state.lastUpdate).toLocaleTimeString('fr-FR'));
    save();
    renderPortfolio();
    if(state.newsEnabled){ window.News && News.refresh(); }
  }

  // Multi-lignes
  function addLine(exch, asset, stakeEUR){
    const price = mkt(exch);
    if(!price){ alert('Prix indisponible (attends que les prix s’affichent).'); return; }
    const id = 'L'+Math.random().toString(36).slice(2,8);
    const pos = {
      id, exch, asset, stakeEUR: Number(stakeEUR),
      entryTs: Date.now(),
      entryPrice: price,
      open: true,
      log: [{ts: Date.now(), side:'ENTER', price, amt: stakeEUR}],
      summary: null, journal: []
    };
    state.portfolio.unshift(pos);
    state.selectedId = id;
    save(); renderPortfolio(); renderDetails();
  }

  function exitLine(id){
    const pos = state.portfolio.find(p=>p.id===id); if(!pos || !pos.open){ alert('Cette ligne est déjà clôturée.'); return; }
    const price = mkt(pos.exch); if(!price){ alert('Prix indisponible pour clôturer.'); return; }
    const pnl = (price/pos.entryPrice - 1) * pos.stakeEUR;
    pos.open = false;
    pos.log.unshift({ts:Date.now(), side:'EXIT', price, amt:pnl});
    save(); renderPortfolio(); renderDetails();
    alert('Ligne '+id+' clôturée. Résultat: '+ ( (pnl>=0?'+':'')+fmtEUR.format(pnl) ) );
  }

  function selectLine(id){ state.selectedId=id; save(); renderDetails(); }
  function removeLine(id){
    state.portfolio = state.portfolio.filter(p=>p.id!==id);
    if(state.selectedId===id) state.selectedId = state.portfolio[0]?.id || null;
    save(); renderPortfolio(); renderDetails();
  }

  // Résumés & journal (daily OHLC)
  async function fetchDailyOHLC(days=365){
    try{
      const r = await fetch('https://www.bitstamp.net/api/v2/ohlc/btceur/?step=86400&limit='+days,{cache:'no-store'});
      if(!r.ok) throw new Error('http');
      const j = await r.json();
      const arr = j?.data?.ohlc || [];
      return arr.map(c=>({t: Number(c.timestamp)*1000, o:+c.open, h:+c.high, l:+c.low, c:+c.close})).sort((a,b)=>a.t-b.t);
    }catch(e){
      try{
        const r = await fetch('https://api.coinbase.com/v2/prices/BTC-EUR/historic?period=year',{cache:'no-store'});
        if(!r.ok) throw new Error('http2');
        const j = await r.json();
        const arr = (j?.data?.prices||[]).map(p=>({ t: new Date(p.time).getTime(), c: +p.price }))
          .sort((a,b)=>a.t-b.t);
        return arr.map((d,i,all)=>({t:d.t,o:all[i-1]?.c??d.c,h:Math.max(d.c,all[i-1]?.c??d.c),l:Math.min(d.c,all[i-1]?.c??d.c),c:d.c}));
      }catch(e2){
        return null;
      }
    }
  }
  function pct(a,b){ if(!a||!b) return 0; return (a/b-1)*100; }

  async function buildSummaryFor(pos){
    const candles = await fetchDailyOHLC(365);
    if(!candles) return {data:[], journal:[]};
    const last = candles[candles.length-1];
    const dPrev = candles[candles.length-2];
    const week = candles.slice(-7);
    const month = candles.slice(-30);
    const year = candles.slice(-365);
    const data = [];
    if(last && dPrev) data.push({label:'Jour', pct: pct(last.c,dPrev.c), from:dPrev.c, to:last.c});
    if(week.length>1) data.push({label:'Semaine', pct: pct(week.at(-1).c, week[0].c), from:week[0].c, to:week.at(-1).c});
    if(month.length>1) data.push({label:'Mois', pct: pct(month.at(-1).c, month[0].c), from:month[0].c, to:month.at(-1).c});
    if(year.length>1) data.push({label:'Année', pct: pct(year.at(-1).c, year[0].c), from:year[0].c, to:year.at(-1).c});
    const recent = candles.slice(-14);
    const journal = recent.map((d,i)=>{
      if(i===0) return {date:new Date(d.t).toLocaleDateString('fr-FR'), text:`Clôture: ${fmtEUR.format(d.c)}`};
      const prev = recent[i-1];
      const pc = pct(d.c, prev.c);
      const pnl = (pos.entryPrice? ((d.c/pos.entryPrice - 1) * pos.stakeEUR) : 0);
      return {date:new Date(d.t).toLocaleDateString('fr-FR'),
        text:`${pc>=0?'Hausse':'Baisse'} ${Math.abs(pc).toFixed(2)}% (${fmtEUR.format(prev.c)} → ${fmtEUR.format(d.c)}) — P&L si clôturé : ${(pnl>=0?'+':'')+fmtEUR.format(pnl)}`};
    });
    return {data, journal};
  }

  function renderPortfolio(){
    const box = $('portfolio'); box.innerHTML='';
    if(state.portfolio.length===0){ box.innerHTML = '<div class="note">Aucune ligne pour l’instant. Ajoute-en une au-dessus.</div>'; return; }
    state.portfolio.forEach(pos=>{
      const p = mkt(pos.exch);
      const pnl = p? ( (p/pos.entryPrice - 1) * pos.stakeEUR ) : 0;
      const pctNow = p? ( (p/pos.entryPrice - 1) * 100 ) : 0;
      const card = document.createElement('div'); card.className='card';
      card.innerHTML = `
        <div class="card-head">
          <div class="card-title">${pos.id} • ${pos.exch.toUpperCase()} • ${pos.asset}</div>
          <div class="row">
            <span class="badge">${pos.open? 'OUVERTE':'CLÔTURÉE'}</span>
            <button class="btn" data-act="select">Détails</button>
            ${pos.open? '<button class="btn" data-act="exit">Sortir</button>':''}
            <button class="btn btn-muted" data-act="remove">Supprimer</button>
          </div>
        </div>
        <div class="kpi">
          <div>Entrée: ${new Date(pos.entryTs).toLocaleString('fr-FR')}</div>
          <div>Prix entrée: ${fmtEUR.format(pos.entryPrice)}</div>
          <div>Mise: ${fmtEUR.format(pos.stakeEUR)}</div>
          <div>Prix marché: ${p? fmtEUR.format(p): '—'}</div>
          <div>P&L: ${(pnl>=0?'+':'')+fmtEUR.format(pnl)} (${pctNow.toFixed(2)}%)</div>
        </div>
      `;
      card.querySelector('[data-act="select"]').addEventListener('click', ()=>selectLine(pos.id));
      card.querySelector('[data-act="remove"]').addEventListener('click', ()=>{
        if(confirm('Supprimer cette ligne ?')) removeLine(pos.id);
      });
      if(pos.open){
        card.querySelector('[data-act="exit"]').addEventListener('click', ()=>exitLine(pos.id));
      }
      box.appendChild(card);
    });
  }

  async function renderDetails(){
    const box = $('details');
    const pos = state.portfolio.find(p=>p.id===state.selectedId);
    if(!pos){ box.innerHTML = 'Sélectionne une ligne…'; return; }
    box.innerHTML = '<div class="note">Calcul des résumés…</div>';
    const sum = await buildSummaryFor(pos);
    pos.summary = sum.data; pos.journal = sum.journal; save();
    const lines = (sum.data||[]).map(s=>`<div>${s.label}: ${s.pct>=0?'+':''}${s.pct.toFixed(2)}% (de ${fmtEUR.format(s.from)} à ${fmtEUR.format(s.to)})</div>`).join('');
    const journal = (sum.journal||[]).map(j=>`<li>${j.text}</li>`).join('');
    box.innerHTML = `
      <div class="kpi">${lines || '—'}</div>
      <div style="margin-top:8px"><b>Journal (14 j)</b></div>
      <ul class="news">${journal || '<li>—</li>'}</ul>
    `;
  }

  function bind(){
    $('qa-enter').addEventListener('click', ()=>{
      addLine($('qa-exch').value, $('qa-asset').value, $('qa-stake').value);
    });
    $('qa-clear').addEventListener('click', ()=>{ $('qa-exch').value='kraken'; $('qa-asset').value='BTC-EUR'; $('qa-stake').value=100; });
    $('refresh').addEventListener('change', ()=>{ const r=Math.max(3, Number($('refresh').value)||5); state.refresh=r; save(); restartTimer(); });
    $('fees-mode').addEventListener('change', ()=>{
      state.feesMode = $('fees-mode').value; save();
      $('fees-custom').classList.toggle('hidden', state.feesMode!=='custom');
      if(state.feesMode==='custom'){ state.fees.kraken=Number($('fee-kraken').value)||0.26; state.fees.coinbase=Number($('fee-coinbase').value)||0.40; state.fees.bitstamp=Number($('fee-bitstamp').value)||0.40; save(); }
    });
    ['fee-kraken','fee-coinbase','fee-bitstamp'].forEach(id=>{
      const el=$(id); if(el) el.addEventListener('change', ()=>{ state.fees[id.split('-')[1]] = Number(el.value)||0; save(); });
    });
    $('btn-export').addEventListener('click', ()=>{
      const blob = new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='paper_trader_state_v3.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1500);
    });
    $('btn-import').addEventListener('click', ()=> $('file-import').click());
    $('file-import').addEventListener('change', (ev)=>{
      const f=ev.target.files?.[0]; if(!f) return; const fr=new FileReader();
      fr.onload=()=>{ try{ const obj=JSON.parse(fr.result); Object.assign(state, obj); save(); renderPortfolio(); renderDetails(); alert('Import OK'); }catch(e){ alert('Import invalide'); } };
      fr.readAsText(f);
    });
    $('news-toggle').addEventListener('change', (e)=>{
      state.newsEnabled = e.target.checked; save();
      document.getElementById('news-panel').style.display = state.newsEnabled? 'block':'none';
      if(state.newsEnabled) { window.News && News.refresh(true); }
    });
  }

  let timer=null;
  function restartTimer(){
    if(timer) clearInterval(timer);
    timer = setInterval(tick, Math.max(3, state.refresh)*1000);
  }

  function init(){
    load();
    $('refresh').value = state.refresh;
    $('fees-mode').value = state.feesMode;
    $('fees-custom').classList.toggle('hidden', state.feesMode!=='custom');
    $('fee-kraken').value = state.fees.kraken;
    $('fee-coinbase').value = state.fees.coinbase;
    $('fee-bitstamp').value = state.fees.bitstamp;
    bind();
    renderPortfolio();
    if(state.selectedId) renderDetails();
    if(state.newsEnabled){ document.getElementById('news-panel').style.display='block'; }
    tick(); restartTimer();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
