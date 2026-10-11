// Same role as creator-lab's research.mjs, with ad scale signals in place of views and likes.
export const median=values=>{const a=values.filter(v=>typeof v==='number'&&Number.isFinite(v)).sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2:null;};
const known=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
export const value=(post,field)=>known(post[field])?post[field]:null;
export function filterPosts(posts,{topic='all',hook='all',dimension='mechanism',minDays=0,minConfidence=0,maxDuration=0,dedupe=true}={}){
 return posts.filter(p=>(!dedupe||!p.duplicateOf)&&(!minDays||(known(p.daysRunning)&&p.daysRunning>=minDays))&&(!maxDuration||(known(p.duration)&&p.duration<=maxDuration))&&(topic==='all'||(!p.excludedReason&&p.analysis?.labels.macro?.value===topic))&&(hook==='all'||(!p.excludedReason&&p.analysis?.labels.mechanism?.value===hook))&&(!minConfidence||[dimension,...(topic==='all'?[]:['macro']),...(hook==='all'?[]:['mechanism'])].every(key=>p.analysis?.labels[key]?.confidence>=minConfidence)));
}
export function summarize(posts,metric='rankScore'){
 const values={reach:posts.map(p=>value(p,metric)).filter(known),ads:posts.map(p=>value(p,'adsCount')).filter(known),days:posts.map(p=>value(p,'daysRunning')).filter(known),position:posts.map(p=>value(p,'position')).filter(known)};
 return {n:posts.length,top:posts.filter(p=>p.top).length,adsTotal:values.ads.reduce((s,v)=>s+v,0),...Object.fromEntries(Object.entries(values).map(([k,v])=>[k,median(v)])),counts:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,v.length]))};
}
export function groupPosts(posts,dimension='mechanism',metric='rankScore'){
 const buckets=new Map();for(const p of posts){if(!p.analysis||p.excludedReason)continue;const key=p.analysis.labels[dimension]?.value||'unclear';if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(p);}
 return [...buckets].map(([key,posts])=>({key,posts,...summarize(posts,metric)}));
}
// sort: 'reach' = chosen metric, 'ads' = ads per creative, 'days' = days running, 'top' = creatives in the top 10%.
export function sortExamples(posts,sort='reach',metric='rankScore'){
 const score=p=>sort==='ads'?value(p,'adsCount'):sort==='days'?value(p,'daysRunning'):sort==='top'?(p.top?1:0)*1e6+(value(p,'rankScore')??0):value(p,metric);
 return posts.slice().sort((a,b)=>{const av=score(a),bv=score(b);if(av===null)return bv===null?a.id.localeCompare(b.id):1;if(bv===null)return -1;return bv-av||a.id.localeCompare(b.id);});
}
