import {writeFile} from 'node:fs/promises';
import {dimensions} from './schema.mjs';
import {groupBy,tier,median} from './data.mjs';
import {funnelSection} from './funnel.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usd=v=>v==null?'?':`US$ ${v.toFixed(2)}`;
// Static, self-contained page: open the file in any browser, no server needed.
export async function writeReport(run,path,{funnel=null}={}){
 const cs=run.creatives,done=cs.filter(c=>c.analysis&&!c.duplicateOf),total=Math.max(...cs.map(c=>c.bestPosition||0));
 const ads=cs.reduce((s,c)=>s+c.adsCount,0),bodies=new Set(cs.map(c=>c.body)).size,links=new Set(cs.map(c=>c.linkUrl)).size;
 const months={};for(const c of cs){const m=(c.firstStart||'').slice(0,7);if(m)months[m]=(months[m]||0)+c.adsCount;}
 const maxMonth=Math.max(...Object.values(months));
 const dimTables=Object.entries(dimensions).map(([key,d])=>{const rows=groupBy(done,key);return `<section><h3>${esc(d.title)}</h3><table><thead><tr><th>Valor</th><th>Criativos</th><th>Anuncios</th><th>No topo</th><th>Posicao mediana</th><th>Dias rodando (mediana)</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${esc(r.key)}</b><br><small>${esc(d.question.criteria[r.key]||'')}</small></td><td>${r.n}</td><td>${r.ads}</td><td>${r.top}</td><td>${r.medianPosition??'-'}</td><td>${r.medianDays??'-'}</td></tr>`).join('')}</tbody></table></section>`;}).join('');
 const cards=cs.filter(c=>c.analysis).map(c=>`<article class="card ${tier(c,total)}"><div class="meta"><span class="pos">#${c.bestPosition}</span><span>${c.adsCount} anuncio(s)</span><span>${c.daysRunning??'?'} dias</span><span>${esc(tier(c,total))}</span>${c.duplicateOf?'<span>roteiro repetido</span>':''}</div>
 <p class="open">"${esc(c.analysis.opening)}"</p>
 <div class="tags">${Object.entries(c.analysis.labels).map(([k,l])=>`<span title="${esc(dimensions[k]?.title)} (${Math.round(l.confidence*100)}%)">${esc(k)}: <b>${esc(l.value)}</b></span>`).join('')}</div>
 <details><summary>Roteiro (${Math.round(c.transcript?.duration||0)}s)</summary><ol>${c.analysis.anatomy.map(a=>`<li><b>${esc(a.value)}</b> ${esc(a.text)}</li>`).join('')}</ol></details>
 <a href="${esc(c.libraryUrl)}" target="_blank" rel="noopener">Ver na Ad Library</a></article>`).join('');
 const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ads Lab ${esc(run.name)}</title><style>
:root{--bg:#fafaf9;--fg:#1c1917;--mut:#78716c;--card:#fff;--line:#e7e5e4;--top:#15803d;--acc:#2563eb}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0c0a09;--fg:#f5f5f4;--mut:#a8a29e;--card:#1c1917;--line:#292524;--top:#4ade80;--acc:#60a5fa}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px;max-width:1100px;margin-inline:auto}
h1{margin:0 0 4px}small,.mut{color:var(--mut)}.mut{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;margin:8px 0 24px;font-size:14px;display:block;overflow-x:auto}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0 24px}.kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}.kpi b{font-size:24px;display:block}
.bar{display:flex;align-items:center;gap:8px;font-size:13px}.bar i{display:block;height:10px;background:var(--acc);border-radius:3px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}.card.top{border-color:var(--top)}
.meta{display:flex;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--mut)}.pos{color:var(--fg);font-weight:700}.open{font-weight:600}.tags{display:flex;flex-wrap:wrap;gap:4px;font-size:12px}.tags span{border:1px solid var(--line);border-radius:6px;padding:1px 6px}
a{color:var(--acc)}
.lbl{font-size:11px;font-weight:700;border-radius:4px;padding:1px 5px;margin-right:4px;white-space:nowrap}.lbl.observado{background:#dcfce7;color:#166534}.lbl.inferido{background:#fef3c7;color:#92400e}.lbl.desconhecido{background:#e7e5e4;color:#44403c}
.find{list-style:none;padding:0}.find li{margin:4px 0}.diff{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0}.funil{margin-bottom:28px}.funil h3{overflow-wrap:anywhere}code{overflow-wrap:anywhere;font-size:12px}summary{cursor:pointer;font-weight:600;margin:8px 0}</style></head><body>
<h1>Ads Lab: ${esc(run.name)}</h1><p class="mut">${esc(run.url)}<br>Coletado em ${esc(run.collectedAt.slice(0,10))}. Posicao = ranking de impressoes da propria Ad Library (1 = mais impressoes). "No topo" = 10% melhores posicoes. Descreve a amostra, nao prova causa.${funnel?' <a href="#funil">Ver o funil</a>':''}</p>
<div class="kpis"><div class="kpi"><b>${ads}</b>anuncios ativos</div><div class="kpi"><b>${cs.length}</b>criativos distintos</div><div class="kpi"><b>${bodies}</b>legenda(s)</div><div class="kpi"><b>${links}</b>destino(s)</div><div class="kpi"><b>${median(cs.map(c=>c.daysRunning))??'-'}</b>dias rodando (mediana)</div><div class="kpi"><b>${usd((run.costs?.apify||0)+(run.costs?.transcription||0)+(run.costs?.jev||0))}</b>custo da analise</div></div>
<h2>Quando os anuncios ativos nasceram</h2>${Object.keys(months).sort().map(m=>`<div class="bar"><span style="width:60px">${m}</span><i style="width:${months[m]/maxMonth*300}px"></i>${months[m]}</div>`).join('')}
<h2>Legenda e destino</h2><p><b>${esc(cs[0]?.title||'')}</b></p><p style="white-space:pre-wrap">${esc(cs[0]?.body||'')}</p><p><a href="${esc(cs[0]?.linkUrl)}">${esc(cs[0]?.linkUrl)}</a></p>
${funnelSection(funnel,esc)}
<h2>Padroes (${done.length} roteiros unicos classificados pelo Jev)</h2>${dimTables}
<h2>Criativos por posicao</h2><div class="grid">${cards}</div></body></html>`;
 await writeFile(path,html);return path;
}
