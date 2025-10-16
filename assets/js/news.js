/* news.js — Mode Actu (sans clé API, via proxys publics). */
window.News = (function(){
  const box = document.getElementById('news');
  const sources = [
    (q)=>`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent('https://news.google.com/rss/search?q='+q+'&hl=fr&gl=FR&ceid=FR:fr')}`,
    (q)=>`https://api.allorigins.win/raw?url=${encodeURIComponent('https://news.google.com/rss/search?q='+q+'&hl=fr&gl=FR&ceid=FR:fr')}`
  ];
  const queries = ['Bitcoin EUR','BTC EUR prix','Kraken exchange','Coinbase','Bitstamp','crypto marché'];

  async function fetchOne(url){
    const r = await fetch(url,{cache:'no-store'});
    if(!r.ok) throw new Error('http');
    const ct = r.headers.get('content-type')||'';
    if(ct.includes('application/json')){
      const j = await r.json();
      if(j && j.items){ return j.items.map(x=>({title:x.title, link:x.link, pubDate:x.pubDate})); }
      return [];
    }else{
      const txt = await r.text();
      const items = [...txt.matchAll(/<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/gmi)]
        .map(m=>({title:m[1], link:m[2], pubDate:m[3]}));
      return items;
    }
  }
  function uniqBy(arr, key){ const s=new Set(); return arr.filter(x=>{ const k=x[key]; if(s.has(k)) return false; s.add(k); return true; }); }
  async function refresh(first=false){
    if(!box) return;
    box.innerHTML = first? 'Chargement des actus…' : 'Actualisation…';
    try{
      const results = [];
      for(const q of ['Bitcoin EUR','BTC EUR prix','Kraken exchange','Coinbase','Bitstamp','crypto marché']){
        let got=null;
        for(const make of sources){
          try{ const items = await fetchOne(make(q)); if(items && items.length){ got = items.slice(0,4); break; } }catch(e){}
        }
        if(got) results.push(...got);
      }
      const list = uniqBy(results,'link').slice(0,8);
      if(list.length===0){ box.innerHTML = '<div class="note">Actu indisponible (CORS/proxy). Réessaie plus tard.</div>'; return; }
      box.innerHTML = '<ul class="news">'+ list.map(it=>`<li><a href="${it.link}" target="_blank" rel="noopener">${it.title}</a></li>`).join('') + '</ul>';
    }catch(e){
      box.innerHTML = '<div class="note">Actu indisponible.</div>';
    }
  }
  return { refresh };
})();
