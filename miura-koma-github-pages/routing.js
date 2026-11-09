(function (root) {
  'use strict';
  const R = 6371000, rad = Math.PI / 180;
  const distance = (a, b) => {
    const p = (b.lat - a.lat) * rad, q = (b.lon - a.lon) * rad;
    const h = Math.sin(p / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(q / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  const bearing = (a, b) => Math.atan2((b.lon - a.lon) * Math.cos((a.lat + b.lat) * rad / 2), b.lat - a.lat);
  const angle = x => Math.atan2(Math.sin(x), Math.cos(x));
  const interpolate = (a, b, t) => ({lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t});
  const forbidden = /^(motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway|busway|platform)$/;
  const permit = /^(yes|designated|permissive|destination)$/;
  function walkable(t) {
    if (!t.highway || forbidden.test(t.highway) || /^(no|private|use_sidepath)$/.test(t.foot || '')) return false;
    if (/^(no|private)$/.test(t.access || '') && !permit.test(t.foot || '')) return false;
    if (t.highway === 'service' && /^(driveway|parking_aisle)$/.test(t.service || '') && !permit.test(t.foot || '')) return false;
    return true;
  }
  function graph(data) {
    const nodes = new Map(data.nodes.map(n => [n.id, n]));
    const adj = new Map(), visual = new Map();
    const add = (map, a, b, way, cost = 1) => {
      if (!map.has(a)) map.set(a, []);
      if (!map.get(a).some(e => e.to === b)) map.get(a).push({to: b, way, length: distance(nodes.get(a), nodes.get(b)), cost});
    };
    for (const way of data.ways) {
      const t = way.tags || {};
      if (!t.highway || /^(construction|proposed|platform)$/.test(t.highway)) continue;
      for (let i = 1; i < way.nodes.length; i++) {
        const a = way.nodes[i - 1], b = way.nodes[i];
        if (!nodes.has(a) || !nodes.has(b) || a === b) continue;
        add(visual, a, b, way); add(visual, b, a, way);
        if (!walkable(t)) continue;
        const cost = t.highway === 'steps' ? 1.12 : 1;
        if (t['oneway:foot'] !== '-1' && t['foot:forward'] !== 'no') add(adj, a, b, way, cost);
        if (t['oneway:foot'] !== 'yes' && t['oneway:foot'] !== '1' && t['foot:backward'] !== 'no') add(adj, b, a, way, cost);
      }
    }
    return {nodes, adj, visual, virtual: -1};
  }
  function project(p, a, b) {
    const cos = Math.cos(p.lat * rad), dx = (b.lon - a.lon) * cos, dy = b.lat - a.lat;
    const t = Math.max(0, Math.min(1, (((p.lon - a.lon) * cos) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy || 1)));
    const point = interpolate(a, b, t);
    return {point, t, distance: distance(p, point)};
  }
  function snap(g, location) {
    let best = null;
    for (const [a, edges] of g.adj) for (const e of edges) {
      const p = project(location, g.nodes.get(a), g.nodes.get(e.to));
      if (!best || p.distance < best.distance) best = {...p, a, b: e.to, edge: e};
    }
    if (!best || best.distance > 180) throw new Error('地点の180m以内に歩行可能な道路がありません。地図で近くの道路を指定してください。');
    if (best.t < 0.00001) return {id: best.a, offset: best.distance};
    if (best.t > 0.99999) return {id: best.b, offset: best.distance};
    const id = g.virtual--;
    g.nodes.set(id, {id, ...best.point});
    for (const map of [g.adj, g.visual]) {
      for (const [a, b] of [[best.a, best.b], [best.b, best.a]]) {
        const edges = map.get(a) || [], edge = edges.find(e => e.to === b);
        if (!edge) continue;
        map.set(a, edges.filter(e => e.to !== b).concat({...edge, to: id, length: distance(g.nodes.get(a), best.point)}));
        if (!map.has(id)) map.set(id, []);
        map.get(id).push({...edge, to: b, length: distance(best.point, g.nodes.get(b))});
      }
    }
    return {id, offset: best.distance};
  }
  class Heap {
    constructor() { this.a = []; }
    push(item) { const a = this.a; a.push(item); let i = a.length - 1; while (i > 0) {const p = (i - 1) >> 1; if (a[p].score <= item.score) break; a[i] = a[p]; i = p;} a[i] = item; }
    pop() {const a = this.a, top = a[0], last = a.pop(); if (a.length) {let i = 0; while (2 * i + 1 < a.length) {let j = 2 * i + 1; if (j + 1 < a.length && a[j + 1].score < a[j].score) j++; if (a[j].score >= last.score) break; a[i] = a[j]; i = j;} a[i] = last;} return top; }
  }
  function shortest(g, start, goal) {
    if (start === goal) return [start];
    const heap = new Heap(), costs = new Map([[start, 0]]), previous = new Map();
    heap.push({id: start, score: distance(g.nodes.get(start), g.nodes.get(goal)), cost: 0});
    while (heap.a.length) {
      const current = heap.pop();
      if (current.cost !== costs.get(current.id)) continue;
      if (current.id === goal) {const path = [goal]; while (path[0] !== start) path.unshift(previous.get(path[0])); return path;}
      for (const e of g.adj.get(current.id) || []) {
        const cost = current.cost + e.length * e.cost;
        if (cost >= (costs.get(e.to) ?? Infinity)) continue;
        costs.set(e.to, cost); previous.set(e.to, current.id);
        heap.push({id: e.to, cost, score: cost + distance(g.nodes.get(e.to), g.nodes.get(goal))});
      }
    }
    throw new Error('歩行可能な道路がつながっていません。地点を道路上へ移動するか、経由地を変更してください。');
  }
  function sample(points, cumulative, at) {
    if (at <= 0) return {...points[0], index: 0};
    if (at >= cumulative.at(-1)) return {...points.at(-1), index: points.length - 1};
    let lo = 0, hi = cumulative.length - 1;
    while (lo + 1 < hi) {const mid = (lo + hi) >> 1; if (cumulative[mid] <= at) lo = mid; else hi = mid;}
    return {...interpolate(points[lo], points[hi], (at - cumulative[lo]) / (cumulative[hi] - cumulative[lo] || 1)), index: lo};
  }
  function roadShape(g, id, neighbor, limit = 28) {
    const points = [g.nodes.get(id), g.nodes.get(neighbor)];
    let prev = id, next = neighbor, walked = distance(points[0], points[1]);
    const seen = new Set([id, neighbor]);
    while (walked < limit) {
      const options = (g.visual.get(next) || []).filter(e => e.to !== prev);
      if (options.length !== 1 || seen.has(options[0].to)) break;
      prev = next; next = options[0].to; seen.add(next);
      points.push(g.nodes.get(next)); walked += distance(points.at(-2), points.at(-1));
    }
    const output = [points[0]]; let covered = 0;
    for (let i = 1; i < points.length; i++) {const len = distance(points[i - 1], points[i]); if (covered + len > limit) {output.push(interpolate(points[i - 1], points[i], (limit - covered) / len)); break;} output.push(points[i]); covered += len;}
    return output.map(p => ({lat: p.lat, lon: p.lon}));
  }
  function signOf(n) {
    const t = n.tags || {}, value = t.traffic_sign || t['traffic_sign:forward'] || t['traffic_sign:backward'] || '';
    if (t.highway === 'traffic_signals') return {kind: 'signals', label: '信号機'};
    if (t.highway === 'stop' || /(^|[;,])(stop|JP:330(?:-[AB])?)(?=$|[;,])/i.test(value)) return {kind: 'stop', label: '一時停止'};
    if (t.highway === 'give_way' || value === 'give_way') return {kind: 'giveway', label: '徐行・優先道路'};
    if (value) return {kind: 'other', label: t.name || '道路標識', code: value};
    return null;
  }
  function landmarkInfo(place) {
    const t=place.tags||{}, name=String(place.name||t['name:ja']||t.name||'');
    if(t.advertising && /^(board|sign|totem|column|poster_box)$/.test(t.advertising)) return {kind:'board',category:'看板',priority:100};
    if(t.tourism==='information' && /^(board|map|guidepost)$/.test(t.information||'')) return {kind:'board',category:t.information==='map'?'観光案内図':t.information==='guidepost'?'案内標柱':'案内看板',priority:100};
    if(t.man_made==='lighthouse') return {kind:'lighthouse',category:'灯台',priority:95};
    if(t.historic) return {kind:'memorial',category:/memorial|monument/.test(t.historic)?'記念碑・史跡':'史跡',priority:90};
    if(t.amenity==='place_of_worship'||/^(shrine|temple)$/.test(t.building||'')) return {kind:'shrine',category:t.religion==='shinto'||/神社|神宮/.test(name)?'神社':'寺社',priority:85};
    if(t.tourism==='artwork') return {kind:'memorial',category:'モニュメント',priority:80};
    if(name&&t.natural) return {kind:t.natural==='tree'?'tree':'memorial',category:'自然の目印',priority:80};
    const regional=/三浦|三崎|城ヶ島|白秋|まぐろ|鮪|海南|安房崎|安房埼|うらり|MIURA/i.test(name);
    const physical=t.building||t.shop||t.amenity||t.tourism||t.leisure==='park'||t.man_made||t.natural;
    if(regional&&physical) return {kind:'building',category:'地域の目印',priority:75};
    if(name&&(t.shop==='seafood'||t.amenity==='marketplace')) return {kind:'building',category:'港・市場の目印',priority:70};
    if(name&&(t.tourism==='attraction'||t.tourism==='viewpoint'||t.leisure==='park')) return {kind:'building',category:'名所・公園',priority:60};
    if(name&&(t.shop||['police','townhall','post_office','school'].includes(t.amenity))) return {kind:'building',category:'建物・店舗',priority:30};
    return null;
  }
  // Only omit an unambiguous continuation; unknown physical conditions keep a diagram.
  function continuation(g, ids, index) {
    if(index===0||index===ids.length-1||ids[index-1]===ids[index+1])return false;
    const id=ids[index],prev=ids[index-1],next=ids[index+1],center=g.nodes.get(id);
    const incoming=(g.visual.get(id)||[]).find(e=>e.to===prev);
    const candidates=(g.visual.get(id)||[]).filter(e=>e.to!==prev);
    // A visible but unwalkable branch can still look like the natural continuation.
    if(!incoming||candidates.length<2||candidates.some(e=>!(g.adj.get(id)||[]).some(a=>a.to===e.to)))return false;
    if(signOf(center)||candidates.some(e=>signOf(g.nodes.get(e.to))))return false;
    const approach=roadShape(g,id,prev,8).at(-1),heading=bearing(approach,center);
    let choices=candidates.map(e=>({...e,turn:Math.abs(angle(bearing(center,roadShape(g,id,e.to,8).at(-1))-heading))/rad}));
    // Prefer straight ahead only when it is clearly distinct from every other branch.
    const sorted=[...choices].sort((a,b)=>a.turn-b.turn);
    if(sorted[0].turn<25&&sorted[1].turn-sorted[0].turn>=20)return sorted[0].to===next;
    // Unknown centerlines cannot be inferred from road names or road categories.
    // Width and surface continuity are used only if all branches have explicit data.
    const tags=incoming.way.tags||{};
    for(const key of ['width','surface']) {
      const value=tags[key];
      if(!value||!choices.every(e=>e.way.tags?.[key]))continue;
      const matching=choices.filter(e=>key==='width'
        ? Number.isFinite(Number(value))&&Number.isFinite(Number(e.way.tags[key]))&&Math.abs(Number(value)-Number(e.way.tags[key]))<=.5
        :e.way.tags[key]===value);
      if(matching.length)choices=matching;
    }
    if(choices.length===1)return choices[0].turn<90&&choices[0].to===next;
    choices.sort((a,b)=>a.turn-b.turn);
    // Similar Y branches, sharp turns, unknown slopes/stop-line directions stay visible.
    return choices[0].turn<60&&choices[1].turn-choices[0].turn>=25&&choices[0].to===next;
  }
  // Shape comparison uses the approach orientation, never the route arrow or photos.
  function junctionSignature(frame) {
    if(!Number.isFinite(frame.heading)||!frame.center||!Array.isArray(frame.branches)||frame.branches.length<3)return null;
    const signature=[];
    for(const branch of frame.branches){
      if(!Array.isArray(branch)||branch.length<2)return null;
      const cumulative=[0];
      for(let i=1;i<branch.length;i++)cumulative.push(cumulative.at(-1)+distance(branch[i-1],branch[i]));
      if(cumulative.at(-1)<2)return null;
      const directions=[8,20].map(at=>angle(bearing(frame.center,sample(branch,cumulative,Math.min(at,cumulative.at(-1))))-frame.heading));
      if(directions.some(x=>!Number.isFinite(x)))return null;
      signature.push(directions);
    }
    return signature;
  }
  function similarJunctions(a,b) {
    const left=junctionSignature(a),right=junctionSignature(b);
    return similarSignatures(left,right);
  }
  function similarSignatures(a,b) {
    // Insufficient geometry is not evidence that two junctions can be distinguished.
    if(!a||!b)return true;
    const small=a.length<=b.length?a:b,big=a.length<=b.length?b:a;
    const matches=Array(big.length).fill(-1);
    function assign(i,seen){
      for(let j=0;j<big.length;j++){
        if(seen.has(j)||!small[i].every((v,k)=>Math.abs(angle(v-big[j][k]))<=20*rad))continue;
        seen.add(j);
        if(matches[j]===-1||assign(matches[j],seen)){matches[j]=i;return true;}
      }
      return false;
    }
    let count=0;for(let i=0;i<small.length;i++)if(assign(i,new Set()))count++;
    // Match every branch of the smaller shape; extra roads may be hidden on site.
    return count===small.length;
  }
  function selectFrames(frames, mode='all', edits={}) {
    const keep=frames.map((f,i)=>mode!=='reduced'||i===0||i===frames.length-1||!f.canOmit||(f.checkpoints||[]).length||Object.values(edits[f.id]||{}).some(v=>v&&typeof v==='object'?Object.keys(v).length:!!v));
    const reasons=new Map(),signatures=frames.map(junctionSignature);
    if(mode==='reduced'){
      // Each insertion splits the interval. Restart until no omitted frame resembles
      // the next displayed frame (straight instructions are checked too).
      let changed;
      do{
        changed=false;let previous=0;
        for(let target=1;target<frames.length;target++){
          if(!keep[target])continue;
          for(let i=previous+1;i<target;i++)if(similarSignatures(signatures[i],signatures[target])){
            keep[i]=true;reasons.set(i,`後続の「${frames[target].label||'表示'}」地点と形が似ているため表示`);changed=true;break;
          }
          if(changed)break;
          previous=target;
        }
      }while(changed);
    }
    const selected=frames.map((f,i)=>({...f,retentionReason:reasons.get(i)})).filter((_,i)=>keep[i]);
    return selected.map((f,i)=>({...f,number:i+1,fromPrevious:f.at-(i?selected[i-1].at:0)}));
  }
  function orderWaypoints(locations,random=Math.random) {
    if(locations.length<=2)return [...locations];
    const remaining=locations.slice(1,-1),ordered=[locations[0]],nearCount=Math.ceil(remaining.length/2);
    for(let i=0;i<nearCount;i++){
      let best=0;
      for(let j=1;j<remaining.length;j++)if(distance(ordered.at(-1),remaining[j])<distance(ordered.at(-1),remaining[best]))best=j;
      ordered.push(remaining.splice(best,1)[0]);
    }
    for(let i=remaining.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[remaining[i],remaining[j]]=[remaining[j],remaining[i]];}
    return [...ordered,...remaining,locations.at(-1)];
  }
  function makeFrames(g, ids, visits, data, options) {
    const points=ids.map(id=>g.nodes.get(id)), cumulative=[0];
    for(let i=1;i<points.length;i++) cumulative.push(cumulative.at(-1)+distance(points[i-1],points[i]));
    const total=cumulative.at(-1), signs=data.signs||data.nodes.filter(signOf);
    // Waypoints still control the route, but never create non-junction diagrams.
    const events=[];
    for(let i=0;i<ids.length;i++) if((g.visual.get(ids[i])||[]).length>=3) events.push({at:cumulative[i],nodeIndex:i});
    const boundaries=new Set([0,total,...visits.map(v=>cumulative[v.nodeIndex])]);
    for(let i=1;i<ids.length-1;i++) if(ids[i-1]===ids[i+1]) boundaries.add(cumulative[i]);
    const limits=[...boundaries].sort((a,b)=>a-b), occurrences=new Map();
    const frames=events.map((e,i)=>{
      let lower=0,upper=total;
      for(const limit of limits) {if(limit<e.at-.01)lower=limit;if(limit>e.at+.01){upper=limit;break;}}
      const center=points[e.nodeIndex], beforeAt=Math.max(lower,e.at-24),afterAt=Math.min(upper,e.at+24);
      const before=sample(points,cumulative,beforeAt),after=sample(points,cumulative,afterAt);
      const nearBefore=sample(points,cumulative,Math.max(lower,e.at-8)),nearAfter=sample(points,cumulative,Math.min(upper,e.at+8));
      const heading=e.at===0?bearing(center,nearAfter):bearing(nearBefore,center);
      const turn=e.at===0||e.at===total?0:angle(bearing(center,nearAfter)-heading)/rad;
      const routeIn=[],routeOut=[];
      if(e.at>0){routeIn.push(before);for(let j=0;j<points.length;j++)if(cumulative[j]>beforeAt&&cumulative[j]<e.at)routeIn.push(points[j]);routeIn.push(center);}
      if(e.at<total){routeOut.push(center);for(let j=0;j<points.length;j++)if(cumulative[j]>e.at&&cumulative[j]<afterAt)routeOut.push(points[j]);routeOut.push(after);}
      const occurrence=occurrences.get(ids[e.nodeIndex])||0;occurrences.set(ids[e.nodeIndex],occurrence+1);
      return {id:`junction:${ids[e.nodeIndex]}:${occurrence}`,number:i+1,center:{lat:center.lat,lon:center.lon},routeIndex:e.nodeIndex,at:e.at,kind:'junction',isJunction:true,canOmit:!visits.some(v=>v.nodeIndex===e.nodeIndex)&&continuation(g,ids,e.nodeIndex),checkpoints:[],label:Math.abs(turn)<25?'直進':Math.abs(turn)>155?'折り返し':turn>0?'右へ進む':'左へ進む',heading,branches:(g.visual.get(ids[e.nodeIndex])||[]).map(edge=>roadShape(g,ids[e.nodeIndex],edge.to)),routeIn,routeOut,signs:[],landmark:null,landmarks:[],fromPrevious:e.at-(i?events[i-1].at:0)};
    });
    const unassignedCheckpoints=[];
    for(const visit of visits.filter(v=>v.checkpoint)){
      const arrivalAt=cumulative[visit.nodeIndex];
      const frame=frames.find(f=>f.routeIndex===visit.nodeIndex)||frames.filter(f=>f.at<=arrivalAt).at(-1)||frames[0];
      const cp={number:visit.number,name:visit.name,mission:visit.mission,locationIndex:visit.locationIndex,arrivalAt,center:{lat:points[visit.nodeIndex].lat,lon:points[visit.nodeIndex].lon},offset:frame?arrivalAt-frame.at:0,placement:frame?(Math.abs(arrivalAt-frame.at)<1?'at':arrivalAt>frame.at?'after':'before'):'standalone'};
      if(frame)frame.checkpoints.push(cp);else unassignedCheckpoints.push(cp);
    }
    // Attach a feature to its nearest physical junction, including repeat visits.
    function nearestFrames(p,radius){let best=null;for(const f of frames){const d=distance(p,f.center);if(d<=radius&&(!best||d<best.d))best={f,d};}return best?frames.filter(f=>distance(f.center,best.f.center)<1):[];}
    for(const sign of signs){const shape=signOf(sign);if(!shape)continue;for(const f of nearestFrames(sign,28))f.signs.push({...shape,lat:sign.lat,lon:sign.lon,osmId:sign.id,source:'OpenStreetMap'});}
    const places=(data.places||[]).map(p=>({p,info:landmarkInfo(p)})).filter(x=>x.info).sort((a,b)=>b.info.priority-a.info.priority);
    for(const {p,info} of places){
      if(!Number.isFinite(p.lat)||!Number.isFinite(p.lon))continue;
      for(const f of nearestFrames(p,10)){
        if(f.landmarks.some(l=>l.id===p.id||(l.name===p.name&&l.kind===info.kind&&distance(l,p)<20)))continue;
        f.landmarks.push({...p,...info,source:'OpenStreetMap'});
      }
    }
    for(const f of frames)f.landmark=f.landmarks[0]||null;
    return {generationVersion:7,frames,distance:total,path:points.map(p=>({lat:p.lat,lon:p.lon})),unassignedCheckpoints};
  }
  function generate(data, locations, options = {}) {
    if (locations.length < 2 || locations.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lon))) throw new Error('スタートとゴールの地点を指定してください。');
    const g = graph(data), snapped = locations.map(p => snap(g, p));
    const ids = [], visits = [{...locations[0],nodeIndex:0, locationIndex:0}];
    for (let i = 1; i < snapped.length; i++) {const segment = shortest(g, snapped[i - 1].id, snapped[i].id); ids.push(...(i === 1 ? segment : segment.slice(1))); visits.push({...locations[i],nodeIndex:ids.length-1,locationIndex:i});}
    let checkpointNumber = 0;
    for (const visit of visits) if (visit.checkpoint) {visit.number=++checkpointNumber;visit.name=String(visit.name || 'チェックポイント');visit.mission=(String(visit.mission || '').trim() || 'この場所の案内板を確認し、見つけたことを1つ記録しよう。');}
    if (ids.length < 2) throw new Error('スタートとゴールが同じです。離れた地点か経由地を設定してください。');
    const result = makeFrames(g, ids, visits, data, options);
    return {...result, snapped: snapped.map(s => ({...g.nodes.get(s.id), offset: s.offset})), sourceDate: data.timestamp};
  }
  const api = {distance, bearing, angle, walkable, graph, snap, shortest, generate, continuation, selectFrames, junctionSignature, similarJunctions, orderWaypoints, signOf, project, landmarkInfo};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KomaRouting = api;
})(typeof window === 'undefined' ? globalThis : window);
