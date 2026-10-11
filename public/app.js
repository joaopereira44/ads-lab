// Ported from creator-lab's public/app.js. Same wall -> map -> inspector -> findings flow;
// Reel metrics (views, likes/1k) became ad scale signals (impressions rank, days running, ads per creative).
import {filterPosts,groupPosts,summarize,sortExamples} from './research.mjs';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const openingLine=p=>{const text=p.analysis?.opening||p.transcript?.text||'';const sentence=text.match(/^.*?[.!?](?:\s|$)/s)?.[0]?.trim();return sentence||((text.length>180?text.slice(0,177)+'…':text));};
const title=s=>String(s??'desconhecido').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const compact=n=>n===null||n===undefined?'?':new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(n);
const money=(n,d=4)=>n===null||n===undefined?'?':`$${n.toFixed(d)}`;
const colors=['#899967','#c58e65','#8babc0','#bf8585','#a39dc0','#81aaa0','#c2b275','#929789','#849d65','#bb9279'];
const roleColors={hook:'#b3c966',problem:'#cd937d',demonstration:'#87a9bd',proof:'#889f70',promise:'#b1a4c5',offer:'#c2b275',cta:'#d2b266',other:'#bcc2b4',unclear:'#bcc2b4'};
const METRICS={rankScore:'Ranking de impressoes',adsCount:'Anuncios no criativo'};
let boot,job,selected,dimension='mechanism',category='all',plot=[],groups=[],visible=[],replaying=false,replayToken=0,replayRevealed=new Set(),refreshTimer,metricsInitialized=false;
let compareKeys=new Set(),comparisonOpen=false,examplePage=0;
const api=async(path,data)=>{const r=await fetch(path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Lab-Token':boot.token},body:JSON.stringify(data)});const v=await r.json();if(!r.ok)throw new Error(v.error||'Falhou');return v;};
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,5500);}
const median=a=>{a=a.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2:null;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const safeLink=s=>{try{const u=new URL(s);return u.protocol==='https:'?u.href:'';}catch{return '';}};
const imageURL=p=>`/media/${job.id}/${p.id}`;
const colorFor=value=>colors[Math.max(0,Object.keys(boot.dimensions[dimension].criteria).indexOf(value))%colors.length];
const value=p=>p.excludedReason?(p.status==='no_audio'?'no_audio':'too_little_speech'):p.analysis?.labels[dimension]?.value||(p.status==='failed'?'needs_retry':'unclassified');
const metricName=()=>$('#metric').value;
// rankScore is internal; people read positions (#1 = most impressions).
const position=score=>score===null||score===undefined?'?':`#${Math.round(job.total+1-score)}`;
const showMetric=(v,metric=metricName())=>metric==='rankScore'?position(v):compact(v);
const days=n=>n===null||n===undefined?'?':`${Math.round(n)}`;
// Small deterministic spread so creatives with the same integer value do not stack exactly.
const jitter=id=>{let h=0;for(const c of String(id))h=(h*31+c.charCodeAt(0))|0;return ((h>>>0)%1000)/1000-0.5;};
const emptyJob=()=>({id:'',creator:'',status:'ready',posts:[],costs:{},events:[],total:1,empty:true});
function readStats(){
 const ps=job.posts;const completed=ps.filter(p=>p.analysis);const transcribed=ps.filter(p=>p.transcript);const excluded=ps.filter(p=>p.excludedReason).length;const failed=ps.filter(p=>p.status==='failed').length;
 $('#stat-collected').textContent=compact(ps.length);$('#stat-transcribed').textContent=compact(transcribed.length);$('#stat-classified').textContent=compact(completed.length);
 const jevUnknown=completed.some(p=>p.analysis.costUsd===null);const jev=completed.reduce((s,p)=>s+(p.analysis.costUsd||0),0);
 const audio=transcribed.reduce((s,p)=>s+(p.transcript.costUsd||0),0);
 $('#stat-cost').textContent=jevUnknown?'?':money(jev);
 $('#pipeline-progress').style.width=`${ps.length?completed.length/ps.length*100:0}%`;
 const statusName={ready:'PRONTO',scraping:'COLETANDO',running:'RODANDO',paused:'PAUSADO',partial:'PARCIAL',complete:'COMPLETO'}[job.status]||job.status.toUpperCase();
 $('#pipeline-label').textContent=job.empty?'PRONTO':`${statusName} · ${completed.length}/${ps.length}`;
 $('#cost-detail').textContent=job.empty?'O custo real aparece depois de rodar':`Transcricao ~${money(audio,3)} · Apify ${money(job.costs.apify,3)}`;
 $('#notice').textContent=job.empty?'Nenhuma pesquisa ainda. Clique em Nova analise e cole a pagina do anunciante na Ad Library.':`${job.creator} · ${ps.length} criativos · ${ps.reduce((s,p)=>s+(p.adsCount||0),0)} anuncios · ${completed.length} classificados${excluded?` · ${excluded} sem fala`:''}${failed?` · ${failed} para refazer`:''} · Retrato do dia da coleta`;
 $('#focus-title').textContent=job.empty?'ADS LAB':`${job.creator.toUpperCase()} / ${ps.length} CRIATIVOS / ADS LAB`;$('#intro-copy').textContent=job.empty?'Centenas de anuncios. Poucos movimentos que se repetem. Leia o roteiro por tras do ranking.':`${ps.length} criativos coletados. Leia os roteiros por tras do ranking.`;$('#notice').classList.toggle('real',!job.empty);$('#run-label').textContent=job.empty?'LABORATORIO DE ANUNCIOS':`PESQUISANDO ${job.creator.toUpperCase()}`;
 $('#run-state').textContent=job.status;$('#run-error').textContent=job.error||'';
 $('#events').textContent=(job.events||[]).slice().reverse().map(e=>`${new Date(e.at).toLocaleTimeString('pt-BR')}  ${e.message}`).join('\n');
 const running=['running','scraping'].includes(job.status),done=['complete','partial'].includes(job.status);$('#resume').hidden=job.empty||running||job.status==='complete';$('#pause').hidden=job.empty||!running;$('#export').hidden=job.empty;
 $('#report-link').hidden=job.empty||!done;$('#report-link').href=`/report/${job.id}`;
 $('#run-note').textContent=job.empty?'Cole a pagina de um anunciante na Ad Library para comecar.':`Coletado em ${job.createdAt?new Date(job.createdAt).toLocaleDateString('pt-BR'):'?'} · ${completed.filter(p=>p.analysis.review).length} com rotulo para revisar`;
}
function calculate(){
 const metric=metricName();
 visible=filterPosts(job.posts,{topic:$('#topic-filter').value,hook:$('#hook-filter').value,dimension,minDays:+$('#age').value,minConfidence:+$('#confidence').value,maxDuration:+$('#duration').value,dedupe:$('#dedupe').checked});
 groups=groupPosts(visible,dimension,metric);const sort=$('#research-sort').value;const key={reach:'reach',ads:'ads',days:'days',top:'top'}[sort];groups.sort((a,b)=>(b[key]??-Infinity)-(a[key]??-Infinity)||b.n-a.n||a.key.localeCompare(b.key));
 plot=visible.filter(p=>p.analysis&&!p.excludedReason&&p[metric]>0&&p.daysRunning!==null&&(category==='all'||value(p)===category)).map(p=>({post:p,x:p[metric]+(metric==='adsCount'?jitter(p.id)*0.5:0),y:p.daysRunning}));
}
function renderLegend(){
 const counts=new Map();for(const p of visible)counts.set(value(p),(counts.get(value(p))||0)+1);
 $('#legend').innerHTML=`<button data-category="all" class="${category==='all'?'active':''}">Todos os padroes <b>${visible.length}</b></button>`+[...counts].sort((a,b)=>b[1]-a[1]).map(([k,n])=>`<button data-category="${escape(k)}" class="${category===k?'active':''}"><i class="swatch" style="--color:${colorFor(k)}"></i>${title(k)} <b>${n}</b></button>`).join('');
 $('#legend').querySelectorAll('button').forEach(b=>b.onclick=()=>{stopReplay();category=b.dataset.category;examplePage=0;render();});
}
function makeTile(p){
 const b=document.createElement('button');b.className='tile';b.dataset.id=p.id;b.dataset.initial=p.creator?.[0]?.toUpperCase()||'?';b.setAttribute('aria-label',`Abrir criativo ${p.id}`);const img=document.createElement('img');img.src=imageURL(p);img.alt='';img.decoding='async';img.onerror=()=>b.classList.add('missing');b.append(img);const bar=document.createElement('span');bar.className='tile-color';b.append(bar);b.onclick=()=>selectPost(p.id);return b;
}
function buildTiles(){
 for(const [selector,posts] of [['#tiles',job.posts],['#map-tiles',job.posts.filter(p=>p.analysis&&!p.excludedReason)]]){
  const node=$(selector),wanted=new Set(posts.map(p=>p.id));for(const tile of [...node.children])if(!wanted.has(tile.dataset.id))tile.remove();
  const current=new Set([...node.children].map(n=>n.dataset.id));for(const p of posts)if(!current.has(p.id))node.append(makeTile(p));
 }
}
function layout(){
 if(!job)return;const stage=$('#stage');if(document.body.classList.contains('focused')&&!document.body.classList.contains('portrait')&&innerWidth>760){const height=Math.max(330,Math.floor(innerHeight-(stage.getBoundingClientRect().top+scrollY)-48));if(stage.style.height!==`${height}px`)stage.style.height=`${height}px`;$('.inspector').style.maxHeight=`${height+70}px`;}else{stage.style.height='';$('.inspector').style.maxHeight='';}const w=stage.clientWidth,h=stage.clientHeight,stacked=w<680;stage.classList.add('map','simultaneous');
 const wallW=stacked?w:Math.floor(w*.43)-15,wallH=stacked?Math.floor(h*.36):h;
 const mapX=stacked?0:wallW+30,mapY=stacked?wallH+25:0,mapW=w-mapX,mapH=h-mapY;
 $('#wall-label').style.cssText='left:0;top:0';$('#map-label').style.cssText=`left:${mapX}px;top:${mapY}px`;
 $('#panel-divider').style.cssText=stacked?`left:0;top:${wallH+9}px;width:${w}px;height:1px`:`left:${wallW+14}px;top:0;width:1px;height:${h}px`;
 const gap=3,columns=Math.max(5,Math.ceil(Math.sqrt(Math.max(1,visible.length)*wallW/Math.max(80,wallH-32)*1.2)));
 const cell=Math.min(70,(wallW-(columns-1)*gap)/columns),tileH=Math.min(cell*1.25,(wallH-35)/Math.max(1,Math.ceil(visible.length/columns))-gap);
 // Linear axes: X = chosen scale signal, Y = days running. Upper right = old and high in the impressions ranking.
 const metric=metricName(),domain=plot;
 const xmax=Math.max(metric==='rankScore'?job.total:2,...domain.map(p=>Math.ceil(p.x)),1),xmin=metric==='rankScore'?0:0.5;
 const ymax=Math.max(30,Math.ceil(Math.max(...domain.map(p=>p.y),1)/30)*30);
 const left=mapX+38,right=18,top=mapY+48,bottom=42,pw=Math.max(1,mapW-38-right),ph=Math.max(1,mapH-48-bottom);
 const xy=p=>[left+(p.x-xmin)/(xmax-xmin)*pw,top+(1-p.y/ymax)*ph];
 const lookup=new Map(visible.map((p,i)=>[p.id,i])),posts=new Map(job.posts.map(p=>[p.id,p])),wallPositions=new Map();
 const styleTile=(b,p)=>{b.style.setProperty('--color',colorFor(value(p)));b.classList.toggle('selected',p.id===selected);b.title=`${p.analysis?.opening||p.id} · #${p.position} · ${p.adsCount} anuncio(s) · ${days(p.daysRunning)} dias`;};
 const place=(b,x,y,tw,th)=>{b.style.width=`${Math.max(3,tw)}px`;b.style.height=`${Math.max(4,th)}px`;b.style.transform=`translate(${x}px,${y}px)`;};
 for(const b of $('#tiles').children){const p=posts.get(b.dataset.id),idx=lookup.get(p.id);b.hidden=idx===undefined;if(b.hidden)continue;styleTile(b,p);b.classList.toggle('dimmed',category!=='all'&&value(p)!==category);b.classList.toggle('unseen',replaying&&!replayRevealed.has(p.id));const x=(idx%columns)*(cell+gap),y=Math.floor(idx/columns)*(tileH+gap)+29;wallPositions.set(p.id,{x,y});place(b,x,y,cell,tileH);}
 const active=plot.filter(p=>!replaying||replayRevealed.has(p.post.id)),map=new Map(active.map(p=>[p.post.id,p]));
 for(const b of $('#map-tiles').children){const p=posts.get(b.dataset.id),point=map.get(p.id);styleTile(b,p);b.hidden=false;
  if(!point){b.dataset.plotted='false';b.style.opacity='0';b.style.pointerEvents='none';b.tabIndex=-1;b.setAttribute('aria-hidden','true');b.dataset.arrived='false';b.style.transition='none';const pos=wallPositions.get(p.id)||{x:0,y:29};place(b,pos.x,pos.y,cell,tileH);continue;}
  const [x,y]=xy(point),tw=plot.length>350?12:plot.length>150?16:21;
  const apply=()=>{b.style.transition='';b.style.opacity='1';b.style.pointerEvents='auto';b.tabIndex=0;b.removeAttribute('aria-hidden');place(b,x-tw/2,y-tw*.635,tw,tw*1.27);};
  b.dataset.plotted='true';if(b.dataset.arrived!=='true'){const pos=wallPositions.get(p.id)||{x:0,y:29};b.style.transition='none';place(b,pos.x,pos.y,cell,tileH);b.style.opacity='0';void b.offsetWidth;b.dataset.arrived='true';apply();}else apply();
 }
 const mx=median(active.map(p=>p.x)),my=median(active.map(p=>p.y));let svg='';
 for(let i=0;i<=4;i++){const val=ymax*i/4,y=top+ph*(1-i/4);svg+=`<line x1="${left}" x2="${w-right}" y1="${y}" y2="${y}"/><text x="${left-8}" y="${y+3}" text-anchor="end">${val.toFixed(0)}</text>`;}
 for(let i=0;i<=4;i++){const v=xmin+(xmax-xmin)*i/4,x=left+i/4*pw;svg+=`<text x="${x}" y="${h-13}" text-anchor="middle">${metric==='rankScore'?position(Math.max(1,v)):v.toFixed(v<10?1:0)}</text>`;}
 if(mx!==null){const [x,y]=xy({x:mx,y:my});svg+=`<line class="median" x1="${x}" x2="${x}" y1="${top}" y2="${h-bottom}"/><line class="median" x1="${left}" x2="${w-right}" y1="${y}" y2="${y}"/>`;}
 svg+=`<text x="${left}" y="${mapY+32}">DIAS NO AR ↑</text>`;$('#axes').innerHTML=svg;
 $('#canvas-title').textContent='DO ROTEIRO A ESCALA';$('#canvas-note').textContent=replaying?'Revendo a analise salva':'Tracejado = mediana da amostra';
 $('#plotted-count').textContent=`${visible.length} quadros · ${active.length} / ${plot.length} no mapa`;$('#axis-caption').textContent=metric==='rankScore'?'MAIS IMPRESSOES →':'MAIS ANUNCIOS NO MESMO CRIATIVO →';$('#empty').hidden=visible.length>0;
}
function selectPost(id){selected=id;const p=job.posts.find(p=>p.id===id);if(!p)return;$('#preview-video').pause();$('#preview-video').hidden=true;$('#preview-video').removeAttribute('src');$('.preview-media').classList.remove('playing');$('#preview-image').hidden=false;$('#preview-image').src=imageURL(p);$('#preview-play').hidden=!safeLink(p.videoUrl);$('#post-creator').textContent=p.creator;$('#post-date').textContent=p.publishedAt?`No ar desde ${new Date(p.publishedAt).toLocaleDateString('pt-BR')}`:'Data indisponivel';$('#post-index').textContent=`${job.posts.indexOf(p)+1} / ${job.posts.length}`;
 $('#original').hidden=!safeLink(p.url);$('#original').href=safeLink(p.url);$('#opening').textContent=openingLine(p)||'Esperando a transcricao.';
 $('#post-tags').innerHTML=[p.top?'top 10%':null,p.analysis?.labels.mechanism?.value,p.analysis?.labels.angle?.value].filter(Boolean).map(t=>`<span class="tag">${title(t)}</span>`).join('');
 $('#post-views').textContent=p.position?`#${p.position}`:'?';$('#post-view-label').textContent='Posicao';$('#post-likes').textContent=compact(p.adsCount);$('#post-rate').textContent=days(p.daysRunning);
 const anatomy=p.analysis?.anatomy||[];$('#anatomy-note').textContent=anatomy.some(s=>s.start!==null)?'Trechos com tempo':'Trechos sem tempo';
 $('#anatomy-bar').innerHTML=anatomy.map((s,i)=>`<button title="${title(s.value)}: ${escape(s.text)}" aria-label="Ir ao trecho ${i+1}" data-segment="${i}" style="flex:${Math.max(1,s.text.length)};--color:${roleColors[s.value]||roleColors.other}"></button>`).join('');
 $('#anatomy-legend').innerHTML=[...new Set(anatomy.map(s=>s.value))].map(r=>`<span><i class="swatch" style="--color:${roleColors[r]||roleColors.other}"></i>${title(r)}</span>`).join('');
 $('#transcript').innerHTML=anatomy.length?anatomy.map((s,i)=>`<p class="segment" id="segment-${i}" style="--color:${roleColors[s.value]||roleColors.other}"><small>${s.start!==null?`${Number(s.start).toFixed(1)}s · `:''}${title(s.value)}</small>${escape(s.text)}</p>`).join(''):`<p>${escape(p.transcript?.text||'A transcricao aparece aqui quando o pipeline chegar neste criativo.')}</p>`;
 $('#anatomy-bar').querySelectorAll('button').forEach(b=>b.onclick=()=>{const s=anatomy[+b.dataset.segment];$(`#segment-${b.dataset.segment}`).scrollIntoView({block:'nearest',behavior:'smooth'});if(!$('#preview-video').hidden&&s.start!==null)$('#preview-video').currentTime=s.start;});
 $('#all-labels').innerHTML=Object.entries(p.analysis?.labels||{}).map(([key,a])=>`<div class="label-line"><span>${escape(boot.dimensions[key]?.title||key)}</span><span>${title(a.value)}</span><span>${Math.round(a.confidence*100)}%</span></div>`).join('');
 $('#post-error').textContent=p.excludedReason||((p.error||p.analysis?.review)?'Revisar: '+(p.error||'Alguns rotulos estao incertos. Confira a fala.'):'');
 for(const tile of $$('.tile'))tile.classList.toggle('selected',tile.dataset.id===selected);
}
function researchPosts(){return visible.filter(p=>p.analysis&&!p.excludedReason&&(category==='all'||value(p)===category));}
const sortLabel={reach:'melhor posicao',top:'no topo',ads:'mais anuncios por criativo',days:'mais dias no ar'};
function renderGroups(){
 const metric=metricName(),sort=$('#research-sort').value;const valid=new Set(groups.map(g=>g.key));compareKeys=new Set([...compareKeys].filter(key=>valid.has(key)));if(compareKeys.size!==2)comparisonOpen=false;
 $('#group-title').textContent=boot.dimensions[dimension].title;$('#median-heading').textContent=metric==='rankScore'?'Posicao mediana':'Anuncios no criativo (mediana)';
 const topic=$('#topic-filter').value,hook=$('#hook-filter').value;$('#clear-research').hidden=topic==='all'&&hook==='all';
 const context=[topic==='all'?'Todos os nichos':title(topic),hook==='all'?'Todos os ganchos':title(hook)];$('#research-context').textContent=`${context.join(' · ')} · Comparando ${boot.dimensions[dimension].title.toLowerCase()} · ${groups.reduce((n,g)=>n+g.n,0)} criativos classificados`;
 const summary=summarize(researchPosts(),metric);
 $('#research-summary').innerHTML=[['Criativos',summary.n,`${summary.adsTotal} anuncios · ${visible.length} passam nos filtros`],['Posicao mediana',summary.position===null?'?':`#${Math.round(summary.position)}`,`de ${job.total} no ranking`],['No topo (10%)',summary.top,summary.n?`${Math.round(summary.top/summary.n*100)}% destes criativos`:'-'],['Dias no ar (mediana)',days(summary.days),`${summary.counts.days} com data`]].map(([label,val,note])=>`<div><span>${label}</span><strong>${val}</strong><small>${note}</small></div>`).join('');
 $('#group-table').innerHTML=groups.length?groups.map(g=>`<tr data-pattern="${escape(g.key)}" class="${compareKeys.has(g.key)?'comparing':''}"><td><i class="swatch" style="--color:${colorFor(g.key)}"></i>${title(g.key)}</td><td>${g.n}${g.n<5?'<small class="sample-warning">Amostra pequena</small>':''}</td><td class="${sort==='reach'?'ranked-metric':''}">${showMetric(g.reach)}<small class="metric-count">n=${g.counts.reach}</small></td><td class="${sort==='top'?'ranked-metric':''}">${g.top}<small class="metric-count">${g.n?Math.round(g.top/g.n*100):0}%</small></td><td class="${sort==='ads'?'ranked-metric':''}">${compact(g.ads)}<small class="metric-count">${g.adsTotal} no total</small></td><td class="${sort==='days'?'ranked-metric':''}">${days(g.days)}<small class="metric-count">n=${g.counts.days}</small></td><td><button data-group="${escape(g.key)}">Ver criativos ↗</button></td><td><input type="checkbox" data-compare="${escape(g.key)}" aria-label="Comparar ${escape(title(g.key))}" ${compareKeys.has(g.key)?'checked':''} ${compareKeys.size===2&&!compareKeys.has(g.key)?'disabled':''}></td></tr>`).join(''):'<tr><td colspan="8">Nenhum criativo classificado com esses filtros. Tente outro nicho ou gancho.</td></tr>';
 $('#group-table').querySelectorAll('[data-group]').forEach(b=>b.onclick=()=>{stopReplay();category=b.dataset.group;examplePage=0;render();$('#example-grid').scrollIntoView({behavior:'smooth',block:'start'});});
 $('#group-table').querySelectorAll('[data-compare]').forEach(b=>b.onchange=()=>{if(b.checked)compareKeys.add(b.dataset.compare);else compareKeys.delete(b.dataset.compare);comparisonOpen=false;renderGroups();});
 $('#compare-selected').disabled=compareKeys.size!==2;$('#compare-selected').textContent=`Comparar ${compareKeys.size} / 2`;
 renderComparison();renderExamples();
}
function renderComparison(){
 const selectedGroups=[...compareKeys].map(key=>groups.find(g=>g.key===key)).filter(Boolean);$('#comparison').hidden=!comparisonOpen||selectedGroups.length!==2;if($('#comparison').hidden){$('#comparison').innerHTML='';return;}
 const [a,b]=selectedGroups;const share=g=>g.n?g.top/g.n:null;
 const delta=share(a)!==null&&share(b)!==null?`${title(b.key)} tem ${Math.round(share(b)*100)}% dos criativos no topo, contra ${Math.round(share(a)*100)}% de ${title(a.key).toLowerCase()}, nesta amostra filtrada.`:'Comparacao precisa de criativos nos dois grupos.';
 $('#comparison').innerHTML=`<div class="comparison-heading"><span class="eyebrow">LADO A LADO / MESMOS FILTROS</span><button id="comparison-close" class="quiet" aria-label="Fechar comparacao">×</button></div>`+selectedGroups.map(g=>`<article><small>${g.n} CRIATIVOS${g.n<5?' · AMOSTRA PEQUENA':''}</small><h3>${title(g.key)}</h3><dl><div><dt>Posicao mediana</dt><dd>${g.position===null?'?':`#${Math.round(g.position)}`}</dd></div><div><dt>No topo (10%)</dt><dd>${g.top} <small>de ${g.n}</small></dd></div><div><dt>Anuncios por criativo</dt><dd>${compact(g.ads)} <small>${g.adsTotal} no total</small></dd></div><div><dt>Dias no ar</dt><dd>${days(g.days)} <small>n=${g.counts.days}</small></dd></div></dl><button data-evidence="${escape(g.key)}">Ver os criativos ↗</button></article>`).join('')+`<p>${delta} E uma associacao observada, nao prova de que o padrao causou a escala.</p>`;
 $('#comparison-close').onclick=()=>{comparisonOpen=false;renderComparison();};$('#comparison').querySelectorAll('[data-evidence]').forEach(b=>b.onclick=()=>{stopReplay();category=b.dataset.evidence;examplePage=0;render();$('#example-grid').scrollIntoView({behavior:'smooth',block:'start'});});
}
function renderExamples(){
 const metric=metricName(),sort=$('#research-sort').value;const sorted=sortExamples(researchPosts(),sort,metric),pages=Math.max(1,Math.ceil(sorted.length/6));examplePage=Math.min(examplePage,pages-1);const shown=sorted.slice(examplePage*6,examplePage*6+6);
 $('#examples-title').textContent=category==='all'?`Todos os padroes · ${sorted.length} criativos`:`${title(category)} · ${sorted.length} criativos`;
 $('#examples-all').hidden=category==='all';$('#examples-page').textContent=sorted.length?`${examplePage*6+1}–${Math.min((examplePage+1)*6,sorted.length)} de ${sorted.length} · ${sortLabel[sort]} primeiro`:'Nenhum exemplo';$('#examples-prev').disabled=examplePage===0;$('#examples-next').disabled=examplePage>=pages-1;
 $('#example-grid').innerHTML=shown.length?shown.map(p=>`<article class="example-card" data-post="${escape(p.id)}"><button class="example-thumbnail" data-inspect="${escape(p.id)}" aria-label="Abrir criativo ${escape(p.id)}"><img src="${escape(imageURL(p))}" loading="lazy" alt="Miniatura do criativo"><span>Ler roteiro ↗</span></button><div class="example-copy"><small>${title(p.analysis.labels.angle?.value)} · ${title(p.analysis.labels.mechanism?.value)}</small><h4>${escape(openingLine(p))}</h4><div class="example-metrics"><span><b>#${p.position??'?'}</b> posicao</span><span><b>${compact(p.adsCount)}</b> anuncios</span><span><b>${days(p.daysRunning)}</b> dias no ar</span>${p.top?'<span><b>top 10%</b></span>':''}</div><div class="example-links"><button class="quiet" data-inspect="${escape(p.id)}">Ler roteiro ↗</button>${safeLink(p.url)?`<a href="${escape(safeLink(p.url))}" target="_blank" rel="noopener noreferrer">Ver na Ad Library ↗</a>`:''}</div></div></article>`).join(''):'<p class="examples-empty">Nenhum exemplo nesta combinacao. Limpe um filtro para ver mais criativos.</p>';
 $('#example-grid').querySelectorAll('[data-inspect]').forEach(b=>b.onclick=()=>{selectPost(b.dataset.inspect);$('.inspector').scrollIntoView({behavior:'smooth',block:'center'});});
}
function clearInspector(text){$('#opening').textContent=text;$('#post-creator').textContent=job.creator;$('#preview-image').hidden=true;$('#preview-play').hidden=true;$('#original').hidden=true;$('#transcript').textContent='';$('#anatomy-bar').innerHTML='';$('#anatomy-legend').innerHTML='';$('#all-labels').innerHTML='';$('#post-tags').innerHTML='';$('#post-date').textContent='';$('#post-views').textContent='?';$('#post-likes').textContent='?';$('#post-rate').textContent='?';}
function render(){if(!metricsInitialized&&job.posts.length){$('#metric').value='rankScore';$('#age').value='0';metricsInitialized=true;}readStats();calculate();$('.inspector').classList.toggle('no-matches',!visible.length);$('#inspector-empty').hidden=visible.length>0;renderLegend();buildTiles();layout();renderGroups();if(!selected&&job.posts.length)selectPost((job.posts.find(p=>p.analysis&&!p.excludedReason)||job.posts[0]).id);}
async function loadJob(id){stopReplay();job=id?await api(`/api/runs/${id}`):emptyJob();selected=(job.posts.find(p=>p.analysis&&!p.excludedReason)||job.posts[0])?.id;metricsInitialized=false;category='all';compareKeys.clear();comparisonOpen=false;examplePage=0;$('#topic-filter').value='all';$('#hook-filter').value='all';$('#tiles').innerHTML='';$('#map-tiles').innerHTML='';$('#comparison').hidden=true;render();if(selected)selectPost(selected);else clearInspector(job.empty?'Nenhuma pesquisa ainda.':'Coletando os anuncios. A primeira fala aparece aqui.');if(id)history.replaceState(null,'',`?run=${encodeURIComponent(id)}`);}
async function refresh(){boot=await api('/api/bootstrap');const current=job?.id||'';$('#run-select').innerHTML=boot.runs.length?boot.runs.map(r=>`<option value="${escape(r.id)}">${escape(r.creator)} · ${r.completed}/${r.count} · ${escape(r.status)}</option>`).join(''):'<option value="">Nenhuma pesquisa ainda</option>';if(current)$('#run-select').value=current;renderConnections();}
function renderConnections(){const provider=boot.transcriptionProvider||'groq',active=['apify',provider,'jev'];const count=active.filter(k=>boot.connections[k]?.configured).length;$('#connection-status').textContent=`${count}/3 chaves configuradas`;for(const k of ['apify','groq','fireworks','jev'])$(`#${k}-status`).textContent=boot.connections[k]?.verified?'· chave conferida':boot.connections[k]?.configured?'· configurada':active.includes(k)?'· necessaria':'· opcional';$('#transcription-provider').textContent=title(provider);}

function stopReplay(){replayToken++;replaying=false;replayRevealed.clear();$('#replay').innerHTML='<span>▶</span> Rever a analise';$('#replay-status').textContent='';$$('.tile').forEach(t=>t.classList.remove('processing','unseen'));if(job)layout();}
async function replay(){
 if(replaying){stopReplay();return;}const ready=visible.filter(p=>p.analysis&&!p.excludedReason&&(category==='all'||value(p)===category));if(!ready.length){toast('Classifique alguns criativos antes de rever a analise.');return;}
 replaying=true;replayRevealed.clear();const token=++replayToken;layout();$('#replay').textContent='■ Parar';$('#replay-status').textContent=`REVENDO · 0 / ${ready.length}`;await sleep(450);const chunk=Math.max(1,Math.ceil(ready.length/48));
 for(let i=0;i<ready.length;i+=chunk){if(token!==replayToken)return;for(const p of ready.slice(i,i+chunk)){replayRevealed.add(p.id);const b=$(`#tiles [data-id="${p.id}"]`);b?.classList.add('processing');setTimeout(()=>b?.classList.remove('processing'),450);}layout();selectPost(ready[Math.min(i+chunk-1,ready.length-1)].id);$('#replay-status').textContent=`REVENDO · ${Math.min(i+chunk,ready.length)} / ${ready.length}`;await sleep(125);}
 await sleep(1800);if(token!==replayToken)return;stopReplay();$('#replay-status').textContent='FIM';
}
async function start(){boot=await api('/api/bootstrap');$('#dimension').innerHTML=Object.entries(boot.dimensions).map(([key,v])=>`<option value="${key}">${v.title}</option>`).join('');$('#dimension').value=dimension;for(const [id,key] of [['topic-filter','macro'],['hook-filter','mechanism']])$(`#${id}`).innerHTML=`<option value="all">Todos</option>`+Object.keys(boot.dimensions[key].criteria).map(k=>`<option value="${k}">${title(k)}</option>`).join('');$('#schema-content').innerHTML=Object.entries(boot.dimensions).map(([key,d])=>`<article><h3>${escape(d.title)}</h3><div class="schema-tags">${Object.keys(d.criteria).map(title).join(' / ')}</div><p>${Object.entries(d.criteria).map(([k,v])=>`<b>${title(k)}:</b> ${escape(v)}`).join('<br>')}</p></article>`).join('');await refresh();const params=new URLSearchParams(location.search);const requested=params.get('run');const id=boot.runs.some(r=>r.id===requested)?requested:boot.runs[0]?.id||'';await loadJob(id);if(id)$('#run-select').value=id;if(params.get('focus')==='1')focusDemo(true);
 new ResizeObserver(()=>layout()).observe($('#stage'));const events=new EventSource('/api/events');events.onmessage=e=>{const {id}=JSON.parse(e.data);if(id!==job.id||replaying)return;if(refreshTimer)return;refreshTimer=setTimeout(async()=>{refreshTimer=null;try{const before=job.posts.find(p=>p.id===selected);job=await api(`/api/runs/${id}`);const after=job.posts.find(p=>p.id===selected);render();if(selected&&$('#preview-video').hidden&&(before?.status!==after?.status||before?.analysis?.completedAt!==after?.analysis?.completedAt))selectPost(selected);await refresh();}catch(e){toast(e.message);}},220);};
}
$('#run-select').onchange=e=>loadJob(e.target.value).catch(e=>toast(e.message));
$('#dimension').onchange=e=>{stopReplay();dimension=e.target.value;category='all';compareKeys.clear();comparisonOpen=false;examplePage=0;render();};
for(const id of ['metric','age','confidence','duration','dedupe','topic-filter','hook-filter'])$(`#${id}`).onchange=()=>{stopReplay();category='all';examplePage=0;comparisonOpen=false;render();const first=researchPosts()[0]||visible[0];if(first&&!visible.some(p=>p.id===selected))selectPost(first.id);else if(selected)selectPost(selected);};
$('#clear-research').onclick=()=>{stopReplay();$('#topic-filter').value='all';$('#hook-filter').value='all';category='all';examplePage=0;render();};
$('#research-sort').onchange=()=>{examplePage=0;calculate();renderGroups();};
$('#compare-selected').onclick=()=>{comparisonOpen=true;renderComparison();$('#comparison').scrollIntoView({behavior:'smooth',block:'center'});};
$('#examples-all').onclick=()=>{stopReplay();category='all';examplePage=0;render();};
$('#examples-prev').onclick=()=>{examplePage=Math.max(0,examplePage-1);renderExamples();};
$('#examples-next').onclick=()=>{examplePage++;renderExamples();};
$('#replay').onclick=replay;
$('#preview-play').onclick=()=>{const p=job.posts.find(p=>p.id===selected);if(!p)return;$('#preview-image').hidden=true;$('#preview-play').hidden=true;$('.preview-media').classList.add('playing');$('#preview-video').hidden=false;$('#preview-video').src=safeLink(p.videoUrl);$('#preview-video').play().catch(()=>toast('O video nao tocou: o link da Meta expira em alguns dias. Use "Ver na Ad Library".'));};
function focusDemo(on){document.body.classList.toggle('focused',on);$('.focus-bar').hidden=!on;scrollTo({top:0});setTimeout(layout,20);}$('#focus').onclick=()=>focusDemo(true);$('#focus-exit').onclick=()=>focusDemo(false);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('focused'))focusDemo(false);});
$('#portrait').onclick=()=>{document.body.classList.toggle('portrait');$('#portrait').textContent=document.body.classList.contains('portrait')?'Vista desktop':'Vista retrato';setTimeout(layout,30);};
for(const id of ['new','connections','schema'])$(`#${id}-open`).onclick=()=>$(`#${id}-dialog`).showModal();
$$('[data-close]').forEach(b=>b.onclick=()=>$(`#${b.dataset.close}`).close());
$('#resume').onclick=async()=>{try{await api(`/api/runs/${job.id}/run`,{});job=await api(`/api/runs/${job.id}`);render();}catch(e){toast(e.message);}};
$('#pause').onclick=async()=>{try{await api(`/api/runs/${job.id}/pause`,{});toast('Pausando depois das requisicoes em andamento.');}catch(e){toast(e.message);}};
$('#export').onclick=()=>window.open(`/api/runs/${job.id}/export`,'_blank');
$('#new-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;$('#new-error').textContent='';try{const data=Object.fromEntries(new FormData(e.target));data.name=data.name.trim().toLowerCase();data.url=data.url.trim();const created=await api('/api/runs',data);await refresh();await loadJob(created.id);await refresh();$('#new-dialog').close();}catch(err){$('#new-error').textContent=err.message;}finally{b.disabled=false;}};
$('#connections-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;$('#connections-result').textContent='Conferindo acesso…';try{await api('/api/connections',Object.fromEntries(new FormData(e.target)));e.target.reset();const checks=await api('/api/connections/check',{});$('#connections-result').textContent=Object.entries(checks).map(([k,v])=>`${title(k)}: ${v.verified?'ok':v.error||'falta chave'}`).join(' · ');await refresh();}catch(err){$('#connections-result').textContent=err.message;}finally{b.disabled=false;}};
start().catch(e=>{toast(e.message);$('#notice').textContent='Nao consegui carregar o app local. '+e.message;});
