// Turns a run.json written by run.mjs into the job shape the dashboard reads.
// One "post" per creative. Scale signals replace Reel metrics:
//   rankScore   = total + 1 - best position in the Ad Library impressions sort (higher = more impressions)
//   adsCount    = ads running this same creative and text
//   daysRunning = days since the oldest of those ads started
export function toJob(slug,run,{running=false,events=[],error=null}={}){
 if(!run)return {id:slug,creator:slug,status:running?'scraping':'ready',createdAt:new Date().toISOString(),posts:[],costs:{},events,error,elapsedMs:0,retries:0};
 const total=Math.max(1,...run.creatives.map(c=>c.bestPosition||0));
 const posts=run.creatives.map(c=>({
  id:c.id,url:c.libraryUrl,creator:run.pageName||run.name,caption:[c.title,c.body].filter(Boolean).join('\n'),
  publishedAt:c.firstStart,duration:c.transcript?.duration??null,thumbnailUrl:c.previewUrl,videoUrl:c.videoUrl,
  position:c.bestPosition,rankScore:c.bestPosition?total+1-c.bestPosition:null,adsCount:c.adsCount,
  daysRunning:c.daysRunning===null?null:Math.max(1,c.daysRunning),top:c.bestPosition!==null&&c.bestPosition<=Math.max(10,total*0.1),
  platforms:c.platforms,transcript:c.transcript?{text:c.transcript.text,segments:[],duration:c.transcript.duration,source:c.transcript.source,costUsd:c.transcript.costUsd,reused:c.transcript.reused}:null,
  analysis:c.analysis,status:c.status==='complete'&&running?'complete':c.status,excludedReason:c.excludedReason||null,duplicateOf:c.duplicateOf||null,error:c.error||null}));
 const status=running?'running':run.status||(posts.every(p=>p.analysis||p.excludedReason)?'complete':'paused');
 return {id:slug,creator:run.pageName||run.name,url:run.url,status,createdAt:run.collectedAt,total,posts,
  costs:{apify:run.apifyUsd??run.costs?.apify??null},events,error,elapsedMs:0,retries:0,schemaVersion:run.schemaVersion};
}
