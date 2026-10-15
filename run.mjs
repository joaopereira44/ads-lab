// Ads Lab: Ad Library page -> creatives -> transcription -> Jev -> report.
// Usage:
//   node --env-file=.env run.mjs --url "<Ad Library URL>" --name victor-molinn [--limit 300] [--budget 0.5]
//   node --env-file=.env run.mjs --apify-run <runId> --name victor-molinn   (reuse a paid scrape, no new charge)
//   node --env-file=.env run.mjs --name victor-molinn                       (resume an existing run)
//   add --funil to also portrait each ad destination (flow, tracking, checkout) and diff it with the last one.
//   add --dry-run to check keys and the plan without spending anything.
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import * as providers from './lib/providers.mjs';
import {cacheKey,VERSION} from './lib/schema.mjs';
import {groupCreatives,fingerprint} from './lib/data.mjs';
import {writeReport} from './lib/report.mjs';
import {runFunnel,latestFunnel,findChrome} from './lib/funnel.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
const {values:o}=parseArgs({options:{url:{type:'string'},name:{type:'string'},'apify-run':{type:'string'},limit:{type:'string',default:'300'},budget:{type:'string',default:'0.5'},concurrency:{type:'string',default:'4'},language:{type:'string',default:'pt'},'dry-run':{type:'boolean',default:false},status:{type:'string',default:'active'},funil:{type:'boolean',default:false},'funil-max':{type:'string',default:'3'}}});
if(!o.name||!/^[a-z0-9-]{2,60}$/.test(o.name))throw new Error('--name em kebab-case e obrigatorio (ex.: victor-molinn)');
const env=process.env,provider=env.TRANSCRIPTION_PROVIDER||'groq';
providers.setJevProvider(env.JEV_PROVIDER||'typesafe');
const keys={apify:env.APIFY_TOKEN,transcribe:provider==='groq'?env.GROQ_API_KEY:env.FIREWORKS_API_KEY,jev:(env.JEV_PROVIDER==='vercel'?env.AI_GATEWAY_API_KEY:env.TYPESAFE_API_KEY)};
const dir=join(ROOT,'data','runs',o.name),cacheDir=join(ROOT,'data','cache'),tmp=join(ROOT,'data','tmp');
for(const d of [dir,cacheDir,tmp])await mkdir(d,{recursive:true});
const atomic=async(path,value)=>{const t=path+'.'+randomUUID()+'.tmp';await writeFile(t,JSON.stringify(value,null,2));await rename(t,path);};
const readJSON=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch{return null;}};
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);

if(o['dry-run']){
 for(const [name,key] of [['apify',keys.apify],[provider,keys.transcribe],['jev',keys.jev]]){const r=await providers.checkProvider(name==='groq'||name==='fireworks'?name:name,key);log(name,r.verified?'ok':`FALHOU ${r.error||'sem chave'}`);}
 if(o.funil){const chrome=await findChrome();log('chrome',chrome||'NAO ENCONTRADO (defina CHROME_PATH); o funil sai sem a rede');}
 log('Plano:',o.url?`coletar ate ${o.limit} anuncios (teto US$ ${o.budget})`:o['apify-run']?`reaproveitar run ${o['apify-run']}`:'retomar run existente');process.exit(0);
}

// 1. Collect (or reuse) the raw Ad Library rows.
let run=await readJSON(join(dir,'run.json'));
let raw=await readJSON(join(dir,'raw.json'));
if(!raw){
 let scrape;
 // A started scrape is remembered so a pause or crash never pays Apify twice.
 const started=(await readJSON(join(dir,'scrape.json')))?.id;
 if(o['apify-run']||started)scrape=await providers.pollScrape(o['apify-run']||started,keys.apify);
 else{if(!o.url)throw new Error('Passe --url, --apify-run ou retome um run existente');scrape=await providers.startScrape({url:o.url,limit:Number(o.limit),budget:Number(o.budget),activeStatus:o.status},keys.apify);await atomic(join(dir,'scrape.json'),{id:scrape.id,url:o.url});log('Apify iniciado',scrape.id);}
 log('Coletando anuncios na Apify');
 while(!['SUCCEEDED','FAILED','ABORTED','TIMED-OUT'].includes(scrape.status)){await providers.delay(5000);scrape=await providers.pollScrape(scrape.id,keys.apify);}
 raw=await providers.dataset(scrape.defaultDatasetId,keys.apify,Number(o.limit)+50);
 if(!raw.length)throw new Error(`Apify nao devolveu anuncios (${scrape.status})`);
 await atomic(join(dir,'raw.json'),raw);
 run={name:o.name,pageName:raw[0]?.page_name||raw[0]?.snapshot?.page_name||o.name,url:o.url||raw[0]?.url||'',apifyRun:scrape.id,apifyUsd:scrape.usageTotalUsd??null,collectedAt:new Date().toISOString(),schemaVersion:VERSION,creatives:groupCreatives(raw)};
 await atomic(join(dir,'run.json'),run);log(`${raw.length} anuncios, ${run.creatives.length} criativos`);
}
run.pageName||=raw[0]?.page_name||o.name;
let writing=Promise.resolve();
const save=()=>(writing=writing.catch(()=>{}).then(()=>atomic(join(dir,'run.json'),run)));
// The dashboard pauses a run with SIGTERM: keep what finished, the cache makes resume cheap.
let stopping=false;
process.on('SIGTERM',()=>{stopping=true;log('Pausa pedida; terminando as requisicoes em andamento');});

// 2. Transcribe and classify each creative once (cached across runs).
const pacer=providers.createRequestPacer(Number(env.GROQ_REQUESTS_PER_MINUTE||20));
const pending=run.creatives.filter(c=>c.videoUrl&&(!c.analysis||c.analysis.schemaVersion!==VERSION)&&!c.excludedReason);
let cursor=0,done=0;
run.status='running';await save();
const worker=async()=>{while(cursor<pending.length&&!stopping){const c=pending[cursor++];c.error=null;
 try{
  if(!c.transcript){const cached=await readJSON(join(cacheDir,`transcript-${c.id}.json`));
   c.transcript=cached||await providers.transcribe({videoUrl:c.videoUrl,audioUrl:''},keys.transcribe,tmp,{provider,language:o.language,pacer});
   delete c.transcript.raw;if(!cached)await atomic(join(cacheDir,`transcript-${c.id}.json`),c.transcript);}
  if(c.transcript.text.trim().split(/\s+/).length<6){c.excludedReason='Pouca fala para analisar o roteiro';c.status='no_speech';continue;}
  const t={...c.transcript,adCopy:[c.title,c.body].filter(Boolean).join('\n')};
  const key=cacheKey(t);const cached=await readJSON(join(cacheDir,key+'.json'));
  c.analysis=cached||await providers.classify(t,keys.jev);delete c.analysis.raw;if(!cached)await atomic(join(cacheDir,key+'.json'),c.analysis);
  c.status='complete';
 }catch(e){if(e instanceof providers.NoAudioTrackError){c.status='no_audio';c.excludedReason=e.message;}else{c.status='failed';c.error=e.message;log(c.id,e.message);if([401,403].includes(e.status))throw e;}}
 const n=++done;await save();if(n%10===0||n===pending.length)log(`${n}/${pending.length}`);
}};
log(`${pending.length} criativos para processar`);
await Promise.all(Array.from({length:Number(o.concurrency)},worker));
const seen=new Map();for(const c of run.creatives){if(!c.transcript)continue;const fp=fingerprint(c.transcript.text);c.duplicateOf=seen.get(fp)||null;if(!seen.has(fp))seen.set(fp,c.id);}
run.costs={apify:run.apifyUsd,transcription:run.creatives.reduce((s,c)=>s+(c.transcript?.costUsd||0),0),jev:run.creatives.reduce((s,c)=>s+(c.analysis?.costUsd||0),0)};
run.status=stopping?'paused':run.creatives.some(c=>c.status==='failed')?'partial':'complete';
await save();
if(stopping){log('Pausado');process.exit(0);}
// 3. Funnel portrait (layer 3): only with --funil; otherwise the report keeps the last saved one.
const funnel=o.funil?await runFunnel(run,dir,{log,max:Number(o['funil-max'])}):await latestFunnel(dir);
const report=await writeReport(run,join(dir,'report.html'),{funnel});
const n=s=>run.creatives.filter(c=>c.status===s).length;
log(`Pronto: ${n('complete')} classificados, ${n('failed')} falhas, ${n('no_speech')+n('no_audio')} sem fala. Relatorio: ${report}`);
