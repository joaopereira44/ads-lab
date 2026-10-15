// Layer 3 of the funnel study: what the ad's destination page loads, not only what it shows.
// One dated portrait per destination: the flow the builder ships, the tracking stack read from the
// network, the checkout, and every finding labelled observado / inferido / desconhecido.
// Never fills a form or sends personal data; request bodies are read for event names and dropped.
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {isXquiz,extractFlow,summarizeFlow} from './xquiz.mjs';
import {walk,findChrome} from './browser.mjs';

export const SCHEMA='funil-v1';
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const today=()=>new Date().toLocaleDateString('sv-SE');

// Ad destinations: tracking parameters stripped, most-used first.
export function destinations(creatives){
 const m=new Map();
 for(const c of creatives){if(!/^https?:/.test(c.linkUrl||''))continue;const u=new URL(c.linkUrl);
  for(const k of [...u.searchParams.keys()])if(/^(utm_|fbclid$|gclid$|ttclid$)/.test(k))u.searchParams.delete(k);
  const key=u.href;m.set(key,(m.get(key)||0)+c.adsCount);}
 return [...m].sort((a,b)=>b[1]-a[1]).map(([url,ads])=>({url,ads}));
}

const CHECKOUTS=[[/(^|\.)pay\.hotmart\.com$/,'Hotmart'],[/(^|\.)kiwify\.com\.br$/,'Kiwify'],[/(^|\.)eduzz\.com$/,'Eduzz'],[/(^|\.)ticto\.(app|com\.br)$/,'Ticto'],[/(^|\.)perfectpay\.com\.br$/,'PerfectPay'],[/(^|\.)braip\.com$/,'Braip'],[/(^|\.)monetizze\.com\.br$/,'Monetizze'],[/(^|\.)cakto\.com\.br$/,'Cakto'],[/(^|\.)greenn\.com\.br$/,'Greenn'],[/(^|\.)lastlink\.com$/,'Lastlink']];
const platformOf=url=>{try{const h=new URL(url).hostname;return CHECKOUTS.find(([re])=>re.test(h))?.[1]||null;}catch{return null;}};
const json=s=>{try{return JSON.parse(s);}catch{return null;}};

// Network -> tools, ids and event names. Each rule reads only the fields it names.
export function trackingStack(requests,consoleLines,pageUrl){
 const pageHost=new URL(pageUrl).hostname,tools=new Map();
 const tool=name=>{if(!tools.has(name))tools.set(name,{tool:name,ids:new Set(),events:new Map(),via:new Set(),firstStep:null,notes:new Set()});return tools.get(name);};
 const hit=(name,{id,event,step,via,note}={})=>{const t=tool(name);if(id)t.ids.add(String(id));if(event){if(!t.events.has(event))t.events.set(event,new Set());t.events.get(event).add(step);if(via)t.via.add(via);}if(note)t.notes.add(note.replace(/[.\s]+$/,''));t.firstStep=t.firstStep===null?step:Math.min(t.firstStep,step);};
 for(const r of requests){let u;try{u=new URL(r.url);}catch{continue;}
  const h=u.hostname,p=u.pathname,q=k=>u.searchParams.get(k),step=r.step;
  const embed=r.document&&!r.document.includes(pageHost)?new URL(r.document).hostname:null;
  if(h==='connect.facebook.net'){if(/fbevents\.js$/.test(p))hit('Meta Pixel',{step});const m=p.match(/signals\/config\/(\d+)/);if(m)hit('Meta Pixel',{id:m[1],step});if(/log\/error/.test(p)&&/Bot traffic/i.test(u.search))hit('Meta Pixel',{step,note:'Meta marcou o navegador automatico como robo e bloqueou os eventos do Pixel'});}
  else if(/(^|\.)facebook\.com$/.test(h)&&(p==='/tr'||p==='/tr/'))hit('Meta Pixel',{id:q('id'),event:q('ev'),step,via:'navegador'});
  else if(h===pageHost&&/\/api\/meta\b/.test(p)&&r.postData){const b=json(r.postData);if(b)hit('Meta Pixel',{id:b.pixel_id,event:b.event_name||b.data?.[0]?.event_name,step,via:'servidor (API de Conversoes pelo dominio do funil)'});}
  else if(h==='cdn.utmify.com.br')hit('UTMify',{step,note:/taboola/.test(p)?'script da UTMify para Taboola':undefined});
  else if(h==='tracking.utmify.com.br'){const b=json(r.postData);if(/\/events$/.test(p)&&b)hit('UTMify',{id:b.lead?.pixelId,event:b.type,step});else if(/\/lead$/.test(p)&&r.method==='PUT')hit('UTMify',{event:'registro do visitante (PUT lead)',step});}
  else if(h==='cdn.taboola.com'){const m=p.match(/unip\/(\d+)/);hit('Taboola',{id:m?.[1],step});}
  else if(/taboola\.com$/.test(h)&&/\/log\//.test(p)){const m=p.match(/^\/(\d+)\//);hit('Taboola',{id:m?.[1],event:q('en'),step});}
  else if(/googletagmanager\.com$/.test(h)){const id=q('id')||'';hit(id.startsWith('AW-')?'Google Ads':id.startsWith('GTM-')?'Google Tag Manager':'Google Analytics',{id,step});}
  else if(/googleadservices\.com$/.test(h)||/doubleclick\.net$/.test(h)&&/viewthroughconversion|conversion/.test(p)){const m=p.match(/conversion\/(\d+)/);hit(embed?`Google (dentro do ${embed})`:'Google Ads',{id:m?.[1]&&`AW-${m[1]}`,event:'conversao',step});}
  else if(/doubleclick\.net$/.test(h)&&embed)hit(`Google (dentro do ${embed})`,{step,note:`doubleclick sai do video embutido (${embed}), nao de uma tag do anunciante`});
  else if(/doubleclick\.net$/.test(h))hit('Google Ads',{step,note:'doubleclick na pagina do funil'});
  else if(/google-analytics\.com$/.test(h)&&/collect/.test(p))hit('Google Analytics',{id:q('tid'),event:q('en'),step});
  else if(h==='www.clarity.ms'&&/^\/tag\//.test(p))hit('Microsoft Clarity',{id:p.split('/')[2],step});
  else if(/analytics\.tiktok\.com$/.test(h))hit('TikTok Pixel',{id:q('sdkid'),step});
  else if(/hotjar\.com$/.test(h)){const m=p.match(/hotjar-(\d+)/);hit('Hotjar',{id:m?.[1],step});}
  else if(/\.supabase\.co$/.test(h)&&/functions\/v1\//.test(p)&&r.method==='POST')hit('Contador proprio (Supabase)',{id:p.split('/').pop(),event:[...u.searchParams].map(([k,v])=>`${k}=${v}`).join(' ')||'chamada',step});
  else if(h==='ingest.xquiz.com.br')hit('xQuiz (analytics do construtor)',{step});
  else if(h==='scripts.converteai.net'){const m=p.match(/players\/([a-f0-9]+)/);if(m)hit('vturb (ConverteAI)',{id:m[1],step});}
  else if(/pandavideo\.com\.br$/.test(h))hit('Panda Video',{step});
  else if(h==='www.youtube.com'&&/^\/embed\//.test(p))hit('YouTube embutido',{id:p.split('/')[2],step});
 }
 for(const c of consoleLines){const m=c.text.match(/\[Meta Pixel\] - (.{0,160})/);if(m)tool('Meta Pixel').notes.add(`Aviso do Pixel: ${m[1].replace(/ See 'https.*$/,'').trim().replace(/\.+$/,'')}`);}
 return [...tools.values()].map(t=>({tool:t.tool,ids:[...t.ids].sort(),events:Object.fromEntries([...t.events].map(([k,v])=>[k,[...v].sort((a,b)=>a-b)])),via:[...t.via],firstStep:t.firstStep,notes:[...t.notes]})).sort((a,b)=>a.tool.localeCompare(b.tool));
}

const F=(label,text)=>({label,text});
// Findings: what we saw, what we deduce from it, and what this visit cannot tell.
function findings(p){
 const out=[],f=p.flow,tools=Object.fromEntries((p.network?.tracking||[]).map(t=>[t.tool,t]));
 if(p.builder)out.push(F('observado',`Construtor ${p.builder}${f?`: a pagina entrega o fluxo inteiro (${f.nodes} nos, ${f.edges} setas)`:''}.`));
 else out.push(F('desconhecido','Construtor nao reconhecido: o fluxo completo nao foi lido, so o que o navegador percorreu.'));
 if(f){
  const tail=f.live.filter(s=>!s.options.length).map(s=>s.title);
  out.push(F('observado',`Caminho no ar: ${f.clicks} pergunta(s) por visitante${tail.length?`, depois ${tail.join(' > ')}`:''}${f.live.length-tail.length>f.clicks?` (${f.live.length-tail.length} telas de pergunta contando as variantes do A/B)`:''}.`));
  for(const t of f.abtests)out.push(t.live?F('observado',`Teste A/B ${t.split} ligado ("${t.title}").`):F('observado',`Teste A/B "${t.title}" montado mas sem entrada: desligado.`));
  if(f.offPages.length)out.push(F('observado',`${f.offPages.length} pagina(s) montadas fora do caminho (versao desligada ou teste antigo).`));
  const offer=[...f.live].reverse().find(s=>s.prices.length||s.video);
  if(offer)out.push(F('observado',`Oferta "${offer.title}": ${[offer.prices.length&&`precos ${offer.prices.join(', ')}`,offer.video&&`VSL ${offer.video}`,offer.timer&&`cronometro ${offer.timer}`].filter(Boolean).join(', ')}.`));
  const px=f.live.filter(s=>s.pixel.length).map(s=>`${s.pixel.join('+')} em "${s.title}"`);
  if(px.length)out.push(F('observado',`Evento Meta configurado no fluxo: ${px.join('; ')}.`));
 }
 if(p.network){
  const meta=tools['Meta Pixel'];
  if(meta){
   out.push(F('observado',`Meta Pixel ${meta.ids.join(', ')||'(id nao lido)'} carregado${Object.keys(meta.events).length?`; eventos que sairam: ${Object.entries(meta.events).map(([e,s])=>`${e} (tela ${s.join(',')})`).join(', ')} via ${meta.via.join(' e ')}`:''}.`));
   for(const n of meta.notes)out.push(F('observado',n+'.'));
   out.push(F('desconhecido','Se o Pixel do navegador dispara Lead ou Purchase: o Meta bloqueia navegador automatico, conferir no navegador normal.'));
  }
  for(const t of p.network.tracking.filter(t=>t.tool!=='Meta Pixel'))out.push(F('observado',`${t.tool}${t.ids.length?` ${t.ids.slice(0,4).join(', ')}${t.ids.length>4?` e mais ${t.ids.length-4}`:''}`:''}${Object.keys(t.events).length?`: ${Object.keys(t.events).join(', ')}`:''}${t.notes.length?`. ${t.notes.join('. ')}`:''}.`));
  if(tools['UTMify']?.events['registro do visitante (PUT lead)'])out.push(F('inferido','O "lead" da UTMify na primeira tela e o cadastro do visitante para atribuicao, nao um evento Lead de conversao.'));
  const counter=tools['Contador proprio (Supabase)'];
  if(counter)out.push(F('inferido',`Ele conta entradas por fluxo fora do construtor (${Object.keys(counter.events).join(', ')}): mede A/B por conta propria.`));
  if(!p.network.tracking.some(t=>t.tool==='Google Ads'))out.push(F('desconhecido','Google Ads: nenhuma tag do anunciante no caminho percorrido. Nao ver nao prova que nao existe.'));
  if(p.network.appendedParams.length)out.push(F('inferido',`A pagina acrescenta ${p.network.appendedParams.join(', ')} na URL: atribuicao de venda preparada para o checkout${p.network.appendedParams.includes('sck')?' (sck e o parametro de origem da Hotmart)':''}.`));
 }else out.push(F('desconhecido',`Rede nao lida${p.networkError?`: ${p.networkError}`:''}.`));
 for(const c of p.checkout.filter(c=>c.live))out.push(F('observado',`Checkout ${c.platform||'?'} no caminho: ${c.params}.`));
 const off=p.checkout.filter(c=>!c.live);
 if(off.length)out.push(F('observado',`${off.length} checkout(s) fora do caminho: ${off.map(c=>c.params.match(/src=([^&]+)/)?.[1]||c.platform).join(', ')}.`));
 if(!p.checkout.some(c=>c.live))out.push(F('desconhecido','Plataforma de checkout: nenhum link de checkout visto no caminho.'));
 out.push(F('desconhecido','Qual tela ou variante converte mais, order bump e upsell (o checkout nao foi aberto) e o roteiro da VSL.'));
 return out;
}

const params=url=>{try{const u=new URL(url);return [...u.searchParams].map(([k,v])=>`${k}=${v}`).join('&')||u.pathname;}catch{return url;}};
// Assemble a portrait from the pieces; also used to rebuild an old one from a saved flow.
export function buildPortrait({url,capturedAt,html=null,flow=null,walked=null,networkError=null,source=null}){
 const summary=flow?summarizeFlow(flow):null;
 const checkout=[];
 for(const c of summary?.checkouts||[])checkout.push({platform:platformOf(c.url),url:c.url,params:params(c.url),live:c.live,source:'fluxo'});
 // Without a builder flow, checkout links come from the visible page and the raw HTML (flight strings escape &).
 const fromHtml=summary?[]:((html||'').replace(/\\u0026/g,'&').match(/https?:\/\/[^"'\s<>\\]+/g)||[]);
 for(const l of new Set([...(walked?.links||[]),...fromHtml]))if(platformOf(l)&&!checkout.some(c=>c.url===l))checkout.push({platform:platformOf(l),url:l,params:params(l),live:true,source:'pagina'});
 let network=null;
 if(walked){const first=walked.screens[0]?.url;const added=first?[...new URL(first).searchParams.keys()].filter(k=>!new URL(url).searchParams.has(k)):[];
  network={engine:'Chrome DevTools Protocol',product:walked.product,ms:walked.ms,stopped:walked.stopped,requests:walked.requests.length,
   tracking:trackingStack(walked.requests,walked.console,url),appendedParams:added,
   hosts:[...new Set(walked.requests.map(r=>{try{return new URL(r.url).hostname;}catch{return null;}}).filter(Boolean))].sort(),
   screens:walked.screens.map(s=>({step:s.step,text:s.text.slice(0,240)}))};}
 const p={schema:SCHEMA,url,capturedAt,source,builder:summary?'xQuiz':html&&isXquiz(html)?'xQuiz':null,flow:summary,network,networkError,checkout};
 p.findings=findings(p);return p;
}

async function fetchPage(url){
 const r=await fetch(url,{headers:{'user-agent':UA,'accept-language':'pt-BR,pt;q=0.9'},redirect:'follow',signal:AbortSignal.timeout(30000)});
 return {status:r.status,finalUrl:r.url,html:await r.text()};
}

// One destination: read what the page ships (fetch), then walk it in Chrome for the network.
export async function portrait(url,{log=()=>{}}={}){
 const capturedAt=new Date().toISOString();let html=null,flow=null,walked=null,networkError=null;
 try{const r=await fetchPage(url);html=r.html;if(isXquiz(html))flow=extractFlow(html);log(`  pagina ${r.status}, ${Math.round(html.length/1024)} KB${flow?`, fluxo xQuiz com ${flow.nodes.length} nos`:''}`);}
 catch(e){log(`  pagina nao abriu: ${e.message}`);}
 const clicks=flow?summarizeFlow(flow).clicks:0;
 try{log(`  navegador: ${clicks} clique(s) na primeira opcao, sem preencher nada`);walked=await walk(url,{clicks});log(`  rede: ${walked.requests.length} pedidos em ${Math.round(walked.ms/1000)} s (${walked.stopped})`);}
 catch(e){networkError=e.message;log(`  rede nao lida: ${e.message}`);}
 return buildPortrait({url,capturedAt,html,flow,walked,networkError});
}

// What changed between two portraits of the same destination.
export function diffPortraits(prev,cur){
 const changes=[],notes=[];const add=t=>changes.push(t);
 const a=prev.flow,b=cur.flow;
 if(a&&b){
  if(a.nodes!==b.nodes||a.edges!==b.edges)add(`Fluxo: ${a.nodes} nos e ${a.edges} setas viraram ${b.nodes} e ${b.edges}.`);
  const name=s=>`"${s.title}"${s.slug?` [${[s.slug,...s.clarity.map(c=>c.split('=')[1])].join(', ')}]`:''}`;
  const A=new Map(a.live.map(s=>[s.id,s])),B=new Map(b.live.map(s=>[s.id,s]));
  for(const s of a.live)if(!B.has(s.id))add(`Saiu do caminho: ${name(s)}.`);
  for(const s of b.live)if(!A.has(s.id))add(`Entrou no caminho: ${name(s)}${s.question?`, pergunta "${s.question}"`:''}.`);
  for(const s of b.live){const o=A.get(s.id);if(!o)continue;const before=changes.length;
   if(o.question!==s.question)add(`Pergunta em ${name(s)}: "${o.question}" virou "${s.question}".`);
   if(o.options.join('|')!==s.options.join('|'))add(`Opcoes em ${name(s)}: ${o.options.join(' / ')||'nenhuma'} viraram ${s.options.join(' / ')||'nenhuma'}.`);
   if(o.prices.join()!==s.prices.join())add(`Preco em ${name(s)}: ${o.prices.join(', ')||'nenhum'} virou ${s.prices.join(', ')||'nenhum'}.`);
   if(o.video!==s.video)add(`VSL em ${name(s)}: ${o.video||'nenhuma'} virou ${s.video||'nenhuma'}.`);
   if(o.pixel.join()!==s.pixel.join())add(`Evento Meta em ${name(s)}: ${o.pixel.join(', ')||'nenhum'} virou ${s.pixel.join(', ')||'nenhum'}.`);
   if(o.timer!==s.timer)add(`Cronometro em ${name(s)}: ${o.timer||'nenhum'} virou ${s.timer||'nenhum'}.`);
   if(changes.length===before&&o.hash!==s.hash)add(`Conteudo de ${name(s)} mudou (texto, imagem ou ordem dos blocos).`);}
  for(const t of b.abtests){const o=a.abtests.find(x=>x.title===t.title);if(o&&o.live!==t.live)add(`Teste A/B "${t.title}" ${t.live?'foi ligado':'foi desligado'}.`);if(o&&o.split!==t.split)add(`Teste A/B "${t.title}": ${o.split} virou ${t.split}.`);}
  if(a.offPages.length!==b.offPages.length)add(`Paginas fora do caminho: ${a.offPages.length} viraram ${b.offPages.length}.`);
 }else if(!!a!==!!b)add(b?'O fluxo do construtor apareceu na pagina.':'O fluxo do construtor sumiu da pagina.');
 const live=p=>new Set(p.checkout.filter(c=>c.live).map(c=>c.url));const ca=live(prev),cb=live(cur);
 for(const u of cb)if(!ca.has(u))add(`Checkout novo no caminho: ${params(u)}.`);
 for(const u of ca)if(!cb.has(u))add(`Checkout saiu do caminho: ${params(u)}.`);
 if(prev.network&&cur.network){
  const T=p=>new Map(p.network.tracking.map(t=>[t.tool,t]));const ta=T(prev),tb=T(cur);
  for(const [k,t] of tb){const o=ta.get(k);if(!o){add(`Rastreamento novo: ${k}${t.ids.length?` (${t.ids.join(', ')})`:''}.`);continue;}
   for(const id of t.ids)if(!o.ids.includes(id))add(`${k}: id novo ${id}.`);for(const id of o.ids)if(!t.ids.includes(id))add(`${k}: id ${id} sumiu.`);
   for(const e of Object.keys(t.events))if(!(e in o.events))add(`${k}: evento novo ${e}.`);for(const e of Object.keys(o.events))if(!(e in t.events))add(`${k}: evento ${e} nao apareceu desta vez.`);}
  for(const k of ta.keys())if(!tb.has(k))add(`Rastreamento sumiu: ${k}.`);
 }else if(cur.network&&!prev.network)notes.push('Retrato anterior sem rede: rastreamento sem base para comparar.');
 return {changes,notes};
}

const DIR=runDir=>join(runDir,'funil');
async function funnelFiles(runDir){
 try{return (await readdir(DIR(runDir))).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();}catch{return [];}
}
const readFunnel=async(runDir,f)=>{try{return JSON.parse(await readFile(join(DIR(runDir),f),'utf8'));}catch{return null;}};
export async function latestFunnel(runDir){const files=await funnelFiles(runDir);return files.length?readFunnel(runDir,files.at(-1)):null;}

// --funil: portrait every destination and save one file per day. The terminal compares with the
// last reading (a second run the same day says "sem mudanca"); the file keeps the diff against the
// last earlier day, so the report still shows what changed since then.
export async function runFunnel(run,runDir,{log=console.log,max=3}={}){
 const list=destinations(run.creatives).slice(0,max);if(!list.length){log('Funil: nenhum destino nos anuncios');return null;}
 const date=today(),files=await funnelFiles(runDir);
 const sameDay=files.includes(`${date}.json`)?await readFunnel(runDir,`${date}.json`):null;
 const earlier=files.filter(f=>f<`${date}.json`).at(-1);const prevDay=earlier?await readFunnel(runDir,earlier):null;
 const last=sameDay||prevDay;
 const file={schema:SCHEMA,date,capturedAt:new Date().toISOString(),comparedTo:prevDay?.date||null,destinations:[],changes:{}};
 for(const d of list){log(`Funil: ${d.url} (${d.ads} anuncios)`);const p=await portrait(d.url,{log});p.ads=d.ads;file.destinations.push(p);
  const vsDay=prevDay?.destinations.find(x=>x.url===d.url);
  file.changes[d.url]=vsDay?diffPortraits(vsDay,p):{changes:[],notes:['Primeiro retrato deste destino.']};
  const old=last?.destinations.find(x=>x.url===d.url);
  if(!old){log('  primeiro retrato deste destino');continue;}
  const since=sameDay?`a leitura anterior de hoje (${new Date(sameDay.capturedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})})`:prevDay.date;
  const diff=last===prevDay?file.changes[d.url]:diffPortraits(old,p);
  log(diff.changes.length?`  ${diff.changes.length} mudanca(s) desde ${since}:`:`  sem mudanca desde ${since}`);for(const c of diff.changes)log(`   - ${c}`);for(const n of diff.notes)log(`   (${n})`);
  if(sameDay&&vsDay)log(`  desde ${prevDay.date}: ${file.changes[d.url].changes.length} mudanca(s), no relatorio`);}
 await mkdir(DIR(runDir),{recursive:true});await writeFile(join(DIR(runDir),`${date}.json`),JSON.stringify(file,null,1));
 log(`Funil salvo em funil/${date}.json`);return file;
}

export {findChrome};

// Report section. esc comes from the caller so the page keeps one escaping rule.
export function funnelSection(file,esc){
 if(!file)return '';
 const badge=l=>`<span class="lbl ${l}">${l}</span>`;
 return `<h2 id="funil">Funil: o que a pagina de destino carrega</h2><p class="mut">Retrato de ${esc(file.date)}${file.comparedTo?`, comparado com ${esc(file.comparedTo)}`:''}. Cada achado leva etiqueta: <b>observado</b> (visto na pagina ou na rede), <b>inferido</b> (deduzido do observado), <b>desconhecido</b> (esta visita nao responde). Navegador automatico, sem preencher nada; o Meta bloqueia evento de robo.</p>`+
 file.destinations.map(p=>{const d=file.changes?.[p.url]||{changes:[],notes:[]};const f=p.flow;
  return `<section class="funil"><h3><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a> <small>${p.ads??'?'} anuncio(s)</small></h3>
<div class="diff"><b>${d.changes.length?`${d.changes.length} mudanca(s)${file.comparedTo?` desde ${esc(file.comparedTo)}`:''}`:file.comparedTo&&!d.notes.includes('Primeiro retrato deste destino.')?`Sem mudanca desde ${esc(file.comparedTo)}`:'Primeiro retrato'}</b>${d.changes.length?`<ul>${d.changes.map(c=>`<li>${esc(c)}</li>`).join('')}</ul>`:''}${d.notes.filter(n=>!n.startsWith('Primeiro')).map(n=>`<p class="mut">${esc(n)}</p>`).join('')}</div>
<ul class="find">${p.findings.map(x=>`<li>${badge(x.label)} ${esc(x.text)}</li>`).join('')}</ul>
${f?`<details open><summary>Caminho no ar (${f.live.length} telas)</summary><table><thead><tr><th>Tela</th><th>Pergunta ou titulo</th><th>Opcoes</th><th>Preco, VSL, eventos</th></tr></thead><tbody>${f.live.map(s=>`<tr><td>${esc(s.title)}</td><td>${esc(s.question||'')}</td><td>${s.options.map(esc).join('<br>')}</td><td>${esc([s.prices.join(', '),s.video&&`VSL ${s.video}`,s.timer&&`cronometro ${s.timer}`,s.pixel.length&&`Meta ${s.pixel.join('+')}`,s.clarity.join(' ')].filter(Boolean).join(' | '))}</td></tr>`).join('')}</tbody></table></details>`:''}
${p.network?`<details><summary>Rastreamento (${p.network.tracking.length} ferramentas, ${p.network.requests} pedidos)</summary><table><thead><tr><th>Ferramenta</th><th>Ids</th><th>Eventos (tela)</th><th>Notas</th></tr></thead><tbody>${p.network.tracking.map(t=>`<tr><td>${esc(t.tool)}</td><td>${t.ids.map(esc).join('<br>')}</td><td>${Object.entries(t.events).map(([e,s])=>`${esc(e)} (${s.join(',')})`).join('<br>')}</td><td>${[...t.via,...t.notes].map(esc).join('<br>')}</td></tr>`).join('')}</tbody></table></details>`:''}
${p.checkout.length?`<details><summary>Checkout (${p.checkout.length} link(s))</summary><ul>${p.checkout.map(c=>`<li>${esc(c.platform||'?')} ${c.live?'no caminho':'fora do caminho'}: <code>${esc(c.params)}</code></li>`).join('')}</ul></details>`:''}
${f?.offPages.length?`<details><summary>Paginas fora do caminho (${f.offPages.length})</summary><p class="mut">${f.offPages.map(esc).join(' / ')}</p></details>`:''}</section>`;}).join('');
}
