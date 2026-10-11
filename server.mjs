// Local dashboard for Ads Lab. Same shape as creator-lab's server; the pipeline itself
// stays in run.mjs, which this server spawns and watches.
import http from 'node:http';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {parseEnv} from 'node:util';
import {dimensions,roles,VERSION} from './lib/schema.mjs';
import {checkProvider,download,setJevProvider} from './lib/providers.mjs';
import {toJob} from './lib/adapt.mjs';
const ROOT=dirname(fileURLToPath(import.meta.url));
const PORT=Number(process.env.PORT||5191),HOST='127.0.0.1';
const CSRF=randomBytes(32).toString('hex');
const DATA=process.env.LAB_DATA_DIR||join(ROOT,'data'),RUNS=join(DATA,'runs'),MEDIA=join(DATA,'media');
await mkdir(RUNS,{recursive:true});await mkdir(MEDIA,{recursive:true});
let localEnv={};try{localEnv=parseEnv(await readFile(join(ROOT,'.env'),'utf8'));}catch{}
const env=k=>localEnv[k]||process.env[k];
const transcriptionProvider=env('TRANSCRIPTION_PROVIDER')||'groq';
const jevProvider=env('JEV_PROVIDER')||'typesafe';setJevProvider(jevProvider);
const sessionKeys={},verified={};
const keys=()=>({apify:sessionKeys.apify||env('APIFY_TOKEN'),groq:sessionKeys.groq||env('GROQ_API_KEY'),fireworks:sessionKeys.fireworks||env('FIREWORKS_API_KEY'),jev:sessionKeys.jev||(jevProvider==='vercel'?env('AI_GATEWAY_API_KEY'):env('TYPESAFE_API_KEY'))});
// Keys typed in the Connections dialog reach run.mjs through its environment, never through disk.
const childEnv=()=>{const k=keys();return {...process.env,...localEnv,APIFY_TOKEN:k.apify||'',GROQ_API_KEY:k.groq||'',FIREWORKS_API_KEY:k.fireworks||'',[jevProvider==='vercel'?'AI_GATEWAY_API_KEY':'TYPESAFE_API_KEY']:k.jev||''};};

const children=new Map(),logs=new Map(),errors=new Map();
const clients=new Set();const emit=id=>{for(const res of clients)res.write(`data: ${JSON.stringify({id})}\n\n`);};
const event=(id,message)=>{const list=logs.get(id)||[];list.push({at:new Date().toISOString(),message});logs.set(id,list.slice(-150));};
const readRun=async slug=>{try{return JSON.parse(await readFile(join(RUNS,slug,'run.json'),'utf8'));}catch{return null;}};
const job=async slug=>toJob(slug,await readRun(slug),{running:children.has(slug),events:logs.get(slug)||[],error:errors.get(slug)||null});
async function listRuns(){
 const slugs=new Set([...children.keys()]);try{for(const d of await readdir(RUNS,{withFileTypes:true}))if(d.isDirectory())slugs.add(d.name);}catch{}
 const out=[];for(const slug of slugs){const j=await job(slug);out.push({id:slug,creator:j.creator,status:j.status,createdAt:j.createdAt||'',count:j.posts.length,completed:j.posts.filter(p=>p.analysis).length});}
 return out.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}
function start(slug,args){
 if(children.has(slug))throw new Error('Esta analise ja esta rodando');
 const child=spawn(process.execPath,['run.mjs','--name',slug,...args],{cwd:ROOT,env:childEnv(),stdio:['ignore','pipe','pipe']});
 children.set(slug,child);errors.delete(slug);event(slug,'Pipeline iniciado');emit(slug);
 let buffer='';const onData=chunk=>{buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)if(line.trim()){event(slug,line.replace(/^\d\d:\d\d:\d\d /,''));if(/Error|erro/i.test(line))errors.set(slug,line.slice(0,400));}emit(slug);};
 child.stdout.setEncoding('utf8').on('data',onData);child.stderr.setEncoding('utf8').on('data',onData);
 child.on('exit',code=>{children.delete(slug);event(slug,code===0?'Pipeline terminou':`Pipeline parou (codigo ${code})`);emit(slug);});
 // Live refresh: run.mjs rewrites run.json after every creative.
 const tick=setInterval(()=>{if(!children.has(slug))return clearInterval(tick);emit(slug);},2500);
}
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>1024*1024)throw new Error('Pedido acima de 1 MB');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
const streams=setInterval(()=>{for(const res of clients)res.write(': heartbeat\n\n');},20000);streams.unref();
const mediaPending=new Map();
const server=http.createServer(async(req,res)=>{
 try{
  if(![`127.0.0.1:${PORT}`,`localhost:${PORT}`].includes(req.headers.host)){json(res,403,{error:'Somente acesso local'});return;}
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  const url=new URL(req.url,`http://${HOST}:${PORT}`);const path=url.pathname;
  if(req.method!=='GET'&&(req.headers['x-lab-token']!==CSRF||req.headers.origin&&![`http://${HOST}:${PORT}`,`http://localhost:${PORT}`].includes(req.headers.origin))){json(res,403,{error:'Recarregue a pagina antes de alterar dados'});return;}
  if(path==='/api/bootstrap'){json(res,200,{token:CSRF,transcriptionProvider,dimensions:Object.fromEntries(Object.entries(dimensions).map(([k,v])=>[k,{title:v.title,criteria:v.question.criteria}])),roles,version:VERSION,connections:Object.fromEntries(Object.entries(keys()).map(([k,v])=>[k,{configured:Boolean(v),verified:verified[k]||false}])),runs:await listRuns()});return;}
  if(path==='/api/connections'&&req.method==='POST'){const data=await body(req);for(const name of ['apify','groq','fireworks','jev'])if(typeof data[name]==='string'&&data[name].trim()){sessionKeys[name]=data[name].trim();verified[name]=false;}json(res,200,{saved:true});return;}
  if(path==='/api/connections/check'&&req.method==='POST'){const results=Object.fromEntries(await Promise.all(Object.entries(keys()).map(async([name,key])=>[name,await checkProvider(name,key)])));for(const [name,r]of Object.entries(results))verified[name]=r.verified;json(res,200,results);return;}
  if(path==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});res.write(': connected\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;}
  if(path==='/api/runs'&&req.method==='POST'){
   const d=await body(req);const slug=String(d.name||'').trim().toLowerCase();
   if(!/^[a-z0-9-]{2,60}$/.test(slug))throw new Error('Nome em kebab-case, ex.: victor-molinn');
   if(await readRun(slug)||children.has(slug))throw new Error('Ja existe uma analise com esse nome. Escolha outro ou retome a existente.');
   let adUrl;try{adUrl=new URL(d.url);}catch{throw new Error('Cole a URL da pagina na Ad Library');}
   if(adUrl.hostname!=='www.facebook.com'||!adUrl.pathname.startsWith('/ads/library'))throw new Error('A URL precisa ser da Meta Ad Library (facebook.com/ads/library)');
   const limit=Number(d.limit||300),budget=Number(d.budget||0.5),concurrency=Number(d.concurrency||4);
   if(!Number.isInteger(limit)||limit<1||limit>2000)throw new Error('Escolha de 1 a 2.000 anuncios');
   if(!Number.isFinite(budget)||budget<0.05||budget>10)throw new Error('Teto da Apify entre US$ 0,05 e US$ 10');
   if(![2,4,8].includes(concurrency))throw new Error('Paralelo deve ser 2, 4 ou 8');
   start(slug,['--url',adUrl.href,'--limit',String(limit),'--budget',String(budget),'--concurrency',String(concurrency),'--status',d.status==='all'?'all':'active']);
   json(res,201,await job(slug));return;
  }
  const match=path.match(/^\/api\/runs\/([a-z0-9-]+)(?:\/(run|pause|export))?$/);
  if(match){const [,slug,action]=match;const exists=await readRun(slug)||children.has(slug);if(!exists){json(res,404,{error:'Analise nao encontrada'});return;}
   if(action==='run'&&req.method==='POST'){start(slug,[]);json(res,200,await job(slug));return;}
   if(action==='pause'&&req.method==='POST'){const child=children.get(slug);if(!child)throw new Error('Nada rodando nesta analise');child.kill('SIGTERM');event(slug,'Pausa pedida');emit(slug);json(res,200,{paused:true});return;}
   if(action==='export'){res.setHeader('Content-Disposition',`attachment; filename="${slug}.json"`);json(res,200,await job(slug));return;}
   json(res,200,await job(slug));return;
  }
  const thumb=path.match(/^\/media\/([a-z0-9-]+)\/(\d+)$/);
  if(thumb){const run=await readRun(thumb[1]),c=run?.creatives.find(c=>c.id===thumb[2]);if(!c?.previewUrl){res.writeHead(404);res.end();return;}
   const file=join(MEDIA,c.id+'.img');let bytes;
   try{bytes=await readFile(file);}catch{if(!mediaPending.has(file))mediaPending.set(file,download(c.previewUrl,8*1024*1024).then(async r=>{if(!/^image\/(jpeg|png|webp)/.test(r.type))throw new Error('Formato de imagem nao suportado');await writeFile(file,r.bytes);return r.bytes;}).finally(()=>mediaPending.delete(file)));bytes=await mediaPending.get(file);}
   const type=bytes[0]===0x89?'image/png':bytes.toString('ascii',8,12)==='WEBP'?'image/webp':'image/jpeg';res.writeHead(200,{'Content-Type':type,'Cache-Control':'public, max-age=86400'});res.end(bytes);return;}
  const report=path.match(/^\/report\/([a-z0-9-]+)$/);
  if(report){const html=await readFile(join(RUNS,report[1],'report.html'));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
  const files={'/':'index.html','/app.js':'app.js','/research.mjs':'research.mjs','/styles.css':'styles.css'};
  if(files[path]){const content=await readFile(join(ROOT,'public',files[path]));res.writeHead(200,{'Content-Type':path.endsWith('.css')?'text/css':path.endsWith('.js')||path.endsWith('.mjs')?'text/javascript':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(content);return;}
  json(res,404,{error:'Nao encontrado'});
 }catch(e){json(res,400,{error:e.message||'Falhou'});}
});
const stopAll=()=>{for(const c of children.values())c.kill('SIGTERM');process.exit(0);};
process.on('SIGINT',stopAll);process.on('SIGTERM',stopAll);
server.listen(PORT,HOST,()=>console.log(`Ads Lab pronto em http://${HOST}:${PORT}`));
