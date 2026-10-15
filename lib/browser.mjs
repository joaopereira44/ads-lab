// Minimal Chrome DevTools Protocol client: launch a local Chrome or Edge headless, walk a funnel
// and record every request with the step it happened in. Node's built-in WebSocket, no npm.
// Chrome headless is flagged as a bot by the Meta Pixel: never use this to prove an event fired.
import {spawn} from 'node:child_process';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';

const delay=ms=>new Promise(r=>setTimeout(r,ms));
const exists=async p=>{try{await access(p);return true;}catch{return false;}};

// CHROME_PATH wins; otherwise the usual install places on macOS, Windows and Linux.
export async function findChrome(){
 if(process.env.CHROME_PATH)return (await exists(process.env.CHROME_PATH))?process.env.CHROME_PATH:null;
 const env=process.env,c=[];
 if(process.platform==='darwin')for(const app of ['Google Chrome','Chromium','Microsoft Edge','Brave Browser'])c.push(`/Applications/${app}.app/Contents/MacOS/${app}`,join(env.HOME||'',`Applications/${app}.app/Contents/MacOS/${app}`));
 else if(process.platform==='win32')for(const base of [env.PROGRAMFILES,env['PROGRAMFILES(X86)'],env.LOCALAPPDATA].filter(Boolean))c.push(join(base,'Google/Chrome/Application/chrome.exe'),join(base,'Microsoft/Edge/Application/msedge.exe'),join(base,'Chromium/Application/chrome.exe'));
 else for(const dir of (env.PATH||'').split(delimiter))for(const bin of ['google-chrome','google-chrome-stable','chromium','chromium-browser','microsoft-edge'])c.push(join(dir,bin));
 for(const p of c)if(await exists(p))return p;
 return null;
}

async function launch(path){
 const profile=await mkdtemp(join(tmpdir(),'ads-lab-chrome-'));
 const proc=spawn(path,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--mute-audio','about:blank'],{stdio:['ignore','ignore','pipe']});
 const ws=await new Promise((resolve,reject)=>{let buf='';const t=setTimeout(()=>reject(new Error('Chrome nao abriu a porta de depuracao em 20 s')),20000);
  proc.stderr.setEncoding('utf8').on('data',d=>{buf+=d;const m=buf.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(t);resolve(m[1]);}});
  proc.on('exit',code=>{clearTimeout(t);reject(new Error(`Chrome saiu com codigo ${code}`));});});
 const sock=new WebSocket(ws);await new Promise((res,rej)=>{sock.onopen=res;sock.onerror=()=>rej(new Error('Falha ao conectar no Chrome'));});
 let id=0;const pending=new Map(),listeners=[];
 sock.onmessage=ev=>{const msg=JSON.parse(ev.data);if(msg.id&&pending.has(msg.id)){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(new Error(msg.error.message)):p.resolve(msg.result);}else for(const l of listeners)l(msg);};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const i=++id;pending.set(i,{resolve,reject});sock.send(JSON.stringify({id:i,method,params,sessionId}));});
 const close=async()=>{try{await send('Browser.close');}catch{}sock.close();proc.kill();await delay(300);
  for(let i=0;i<5;i++){try{await rm(profile,{recursive:true,force:true});break;}catch{await delay(500);}}};
 return {send,on:fn=>listeners.push(fn),close,version:()=>send('Browser.getVersion')};
}

// Visible form fields mean the next step asks for personal data: the walk stops there.
const PROBE=`(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'};
 const form=[...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea,select')].some(vis);
 const player=!!document.querySelector('vturb-smartplayer,video,iframe[src*="youtube"],iframe[src*="vimeo"],iframe[src*="pandavideo"]');
 const b=[...document.querySelectorAll('main button')].find(vis);let target=null;
 if(b){b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();target={x:r.x+r.width/2,y:r.y+r.height/2,label:b.innerText.trim().slice(0,80)};}
 return {form,player,target,url:location.href,text:(document.querySelector('main')||document.body).innerText.replace(/\\s+/g,' ').trim().slice(0,600),
  links:[...document.querySelectorAll('a[href^="http"]')].map(a=>a.href).slice(0,200)};})()`;

// Walk: load, wait, click the first answer `clicks` times (never on a form or the offer page), wait for the VSL.
export async function walk(url,{clicks=0,settleMs=5000,stepMs=3500,endMs=25000,chrome}={}){
 const path=chrome||await findChrome();if(!path)throw new Error('Chrome ou Edge nao encontrado; defina CHROME_PATH');
 const b=await launch(path);const t0=Date.now();
 try{
  const {product}=await b.version();
  const requests=[],consoleLines=[],frames=new Map();let step=0;
  b.on(msg=>{const p=msg.params||{};
   if(msg.method==='Network.requestWillBeSent'){const r=p.request;requests.push({step,method:r.method,url:r.url,postData:r.postData||null,frame:frames.get(msg.sessionId)||null,document:p.documentURL||null,initiator:p.initiator?.url||p.initiator?.stack?.callFrames?.[0]?.url||null});}
   else if(msg.method==='Runtime.consoleAPICalled')consoleLines.push({step,text:(p.args||[]).map(a=>a.value??a.description??'').join(' ').slice(0,300)});
   else if(msg.method==='Log.entryAdded')consoleLines.push({step,text:String(p.entry?.text||'').slice(0,300)});
   else if(msg.method==='Target.attachedToTarget'){const s=p.sessionId;frames.set(s,p.targetInfo?.url||p.targetInfo?.type);
    // Cross-origin iframes (video players) run in their own target: their requests only show when attached.
    b.send('Network.enable',{},s).then(()=>b.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true},s)).catch(()=>{}).finally(()=>b.send('Runtime.runIfWaitingForDebugger',{},s).catch(()=>{}));}
  });
  const {targetId}=await b.send('Target.createTarget',{url:'about:blank'});
  const {sessionId:s}=await b.send('Target.attachToTarget',{targetId,flatten:true});
  for(const m of ['Network.enable','Page.enable','Runtime.enable','Log.enable'])await b.send(m,{},s);
  await b.send('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:2,mobile:true},s);
  await b.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true},s);
  const loaded=new Promise(r=>b.on(m=>{if(m.method==='Page.loadEventFired'&&m.sessionId===s)r();}));
  await b.send('Page.navigate',{url},s);await Promise.race([loaded,delay(30000)]);await delay(settleMs);
  const probe=async()=>(await b.send('Runtime.evaluate',{expression:PROBE,returnByValue:true},s)).result.value;
  const screens=[];let stopped='cliques previstos feitos';
  for(let i=0;i<clicks;i++){
   const p=await probe();screens.push({step,url:p.url,text:p.text});
   if(p.form){stopped='formulario na tela (nao preenchemos)';break;}
   if(p.player){stopped='chegou na pagina com video';break;}
   if(!p.target){stopped='sem botao para seguir';break;}
   step++;
   for(const type of ['mouseMoved','mousePressed','mouseReleased'])await b.send('Input.dispatchMouseEvent',{type,x:p.target.x,y:p.target.y,button:'left',clickCount:1},s);
   await delay(stepMs);
  }
  await delay(clicks?endMs:Math.max(0,endMs-settleMs));
  const last=await probe();screens.push({step,url:last.url,text:last.text});
  return {product,ms:Date.now()-t0,stopped,screens,links:last.links,requests,console:consoleLines.slice(0,200)};
 }finally{await b.close();}
}
