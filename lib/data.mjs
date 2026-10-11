import {createHash} from 'node:crypto';
export const median=values=>{const a=values.filter(v=>v!==null&&Number.isFinite(v)).sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2:null;};
const day=864e5;
// One Ad Library row (curious_coder actor) -> flat ad.
export function normalizeAd(row){
 const s=row.snapshot||{};const video=(s.videos||[])[0]||(s.cards||[]).find(c=>c.video_hd_url||c.video_sd_url)||{};
 const id=String(row.ad_archive_id||'');if(!/^\d{5,25}$/.test(id))throw new Error('Missing ad id');
 return {id,creativeId:String(row.collation_id||id),position:Number.isFinite(row.position)?row.position:null,
  pageName:row.page_name||s.page_name||'',pageId:String(row.page_id||''),
  startDate:row.start_date?new Date(row.start_date*1000).toISOString():null,
  endDate:row.end_date?new Date(row.end_date*1000).toISOString():null,active:row.is_active!==false,
  platforms:row.publisher_platform||[],format:s.display_format||'',
  body:s.body?.text||'',title:s.title||'',linkUrl:s.link_url||'',cta:s.cta_text||'',
  videoUrl:video.video_hd_url||video.video_sd_url||'',previewUrl:video.video_preview_image_url||(s.images||[])[0]?.original_image_url||'',
  libraryUrl:row.ad_library_url||`https://www.facebook.com/ads/library/?id=${id}`};
}
// Ads that share a collation_id run the same creative and text. Meta groups them in the Library.
export function groupCreatives(rows,now=Date.now()){
 const groups=new Map();
 for(const row of rows){let ad;try{ad=normalizeAd(row);}catch{continue;}if(!groups.has(ad.creativeId))groups.set(ad.creativeId,[]);groups.get(ad.creativeId).push(ad);}
 return [...groups].map(([id,ads])=>{
  ads.sort((a,b)=>(a.position??1e9)-(b.position??1e9));const lead=ads.find(a=>a.videoUrl)||ads[0];
  const firstStart=ads.map(a=>a.startDate).filter(Boolean).sort()[0]||null;
  return {id,ads:ads.map(a=>a.id),adsCount:ads.length,bestPosition:lead.position,
   firstStart,daysRunning:firstStart?Math.max(0,Math.round((now-Date.parse(firstStart))/day)):null,
   platforms:[...new Set(ads.flatMap(a=>a.platforms))],format:lead.format,body:lead.body,title:lead.title,
   linkUrl:lead.linkUrl,cta:lead.cta,videoUrl:lead.videoUrl,previewUrl:lead.previewUrl,libraryUrl:lead.libraryUrl,
   transcript:null,analysis:null,status:lead.videoUrl?'queued':'no_video',error:null};
 }).sort((a,b)=>(a.bestPosition??1e9)-(b.bestPosition??1e9));
}
export function fingerprint(text){return createHash('sha256').update(text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()).digest('hex');}
// Tiers by Meta's impressions ranking: the Library sorts the page's ads by total impressions.
export function tier(c,total){const p=c.bestPosition;if(p===null)return 'unknown';return p<=Math.max(10,total*0.1)?'top':p<=total*0.5?'middle':'tail';}
export function groupBy(creatives,dimension){
 const total=Math.max(...creatives.map(c=>c.bestPosition||0));const buckets=new Map();
 for(const c of creatives){if(!c.analysis)continue;const key=c.analysis.labels[dimension]?.value||'unclear';if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(c);}
 return [...buckets].map(([key,cs])=>({key,n:cs.length,ads:cs.reduce((s,c)=>s+c.adsCount,0),top:cs.filter(c=>tier(c,total)==='top').length,
  medianPosition:median(cs.map(c=>c.bestPosition)),medianDays:median(cs.map(c=>c.daysRunning)),ids:cs.map(c=>c.id)})).sort((a,b)=>b.ads-a.ads);
}
