// xQuiz (xquiz.co) delivers the whole funnel in the page load: every node, edge and variable
// sits in the Next.js flight data (self.__next_f.push). Ported from the vault scripts
// Projetos/Produtos/atelie-das-velas/scripts/extract.mjs and render.mjs (quiz do Victor Molin, 2026-10-12).
import {createHash} from 'node:crypto';

export const isXquiz=html=>/cdn\.xquiz\.co|xquiz\.com\.br/.test(html)&&html.includes('self.__next_f.push');

// Flight strings -> the largest "nodes":[...] and "edges":[...] arrays, found by bracket matching.
export function extractFlow(html){
 const re=/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;let s='',m;
 while((m=re.exec(html)))s+=JSON.parse(m[1]);
 const grab=key=>{const out=[];let i=0;while((i=s.indexOf(`"${key}":[`,i))>=0){const st=i+key.length+3;let d=0,j=st;
  for(;j<s.length;j++){const c=s[j];if(c==='"'){j++;while(j<s.length&&s[j]!=='"'){if(s[j]==='\\')j++;j++;}continue;}if(c==='[')d++;else if(c===']'){d--;if(d===0)break;}}
  try{out.push(JSON.parse(s.slice(st,j+1)));}catch{}i=j;}return out.sort((a,b)=>b.length-a.length)[0]||null;};
 const nodes=grab('nodes'),edges=grab('edges');
 return nodes&&edges?{nodes,edges}:null;
}

const strip=h=>String(h||'').replace(/<\/p>\s*<p[^>]*>/g,' / ').replace(/<br\s*\/?>/g,' / ').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').replace(/^( \/ )+|( \/ )+$/g,'').trim();
const prices=text=>[...new Set(String(text).match(/R\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?/g)||[])].map(p=>p.replace(/\s/,' '));
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,12);

// One page node -> what a person sees and what the page fires, without layout noise.
function screen(n){
 const d=n.data,s={id:n.id,slug:d.slug||null,title:d.title,question:null,options:[],buttons:[],pixel:[],clarity:[],video:null,timer:null,redirect:null,loading:null,prices:[],hash:hash(d.content||[])};
 const texts=[];
 for(const c of d.content||[]){const x=c.data||{};
  if(c.type==='title'||c.type==='titleV3'){const t=strip(x.title?.content??x.title);s.question??=t;texts.push(t,strip(x.subtitle?.content??x.subtitle));}
  else if(c.type==='quiz')s.options.push(...(x.content||[]).map(o=>`${o.emoji?o.emoji+' ':''}${strip(o.title)}`.trim()));
  else if(c.type==='buttonV3')s.buttons.push(strip(x.title));
  else if(c.type==='metaPixel'&&x.active!==false)s.pixel.push(x.eventName||x.eventType);
  else if(c.type==='scriptV3'){const m=(x.script||'').match(/clarity\("set",\s*"([^"]+)",\s*"([^"]+)"/);if(m)s.clarity.push(`${m[1]}=${m[2]}`);}
  else if(c.type==='videoV3'){const m=(x.source||'').match(/players\/([a-f0-9]{16,})|vid-([a-f0-9]+)/);s.video=m?(m[1]||m[2]):x.type||'video';}
  else if(c.type==='stopWatchTime')s.timer=`${x.minutes}min${x.seconds}s`;
  else if(c.type==='redirectV3')s.redirect=x.time;
  else if(c.type==='loadingV3'){s.loading=x.time;texts.push(strip(x.title));}
  else texts.push(strip(JSON.stringify(x).replace(/\\u003c/g,'<')));
 }
 s.prices=prices(texts.join(' ')+' '+s.buttons.join(' '));
 return s;
}

// Flow -> live path (reachable from the start node), switched-off pages, A/B tests and checkout links.
export function summarizeFlow(flow){
 const byId=new Map(flow.nodes.map(n=>[n.id,n]));const out=id=>flow.edges.filter(e=>e.source===id);
 const start=flow.nodes.find(n=>n.data?.type==='start');const live=new Set();const order=[];const q=start?[start.id]:[];
 while(q.length){const id=q.shift();if(live.has(id)||!byId.has(id))continue;live.add(id);order.push(id);for(const e of out(id))q.push(e.target);}
 const pages=order.map(id=>byId.get(id)).filter(n=>n.type!=='function').map(screen);
 const fn=t=>flow.nodes.filter(n=>n.data?.type===t);
 // How many answers a visitor gives before the offer, following the first option of each screen.
 let clicks=0;const seen=new Set();let cur=start?.id;
 while(cur&&!seen.has(cur)){seen.add(cur);const n=byId.get(cur);const quiz=n?.data?.content?.find(c=>c.type==='quiz');
  let next;if(quiz){clicks++;const first=quiz.data?.content?.[0]?.id;next=(out(cur).find(e=>e.sourceHandle===first)||out(cur)[0])?.target;}
  else next=out(cur)[0]?.target;cur=next;}
 return {
  nodes:flow.nodes.length,edges:flow.edges.length,clicks,
  live:pages,
  questions:pages.filter(p=>p.options.length).length,
  offPages:flow.nodes.filter(n=>n.type!=='function'&&!live.has(n.id)).map(n=>n.data.title),
  abtests:fn('abtest').map(n=>({title:n.data.title,split:`${n.data.asPercentage}/${100-n.data.asPercentage}`,live:live.has(n.id)})),
  checkouts:fn('link').map(n=>({title:n.data.title,url:n.data.url,live:live.has(n.id)})),
 };
}
