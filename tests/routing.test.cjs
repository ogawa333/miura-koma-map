const {test}=require('node:test');
const assert=require('node:assert/strict');
const r=require('../miura-koma-github-pages/routing.js');
function junction(outgoing, tags={}) {
  const positions=[[0,-20],[0,0],...outgoing];
  const nodes=positions.map(([x,y],i)=>({id:i+1,lat:y/111320,lon:x/111320}));
  const ways=[{id:1,nodes:[1,2],tags:{highway:'residential',...tags}},...outgoing.map((_,i)=>({id:i+2,nodes:[2,i+3],tags:{highway:'residential',...tags}}))];
  return {nodes,ways,places:[],signs:[]};
}
test('clear straight may be omitted; turning off it must remain',()=>{
  const g=r.graph(junction([[0,20],[20,0]]));
  assert.equal(r.continuation(g,[1,2,3],1),true);
  assert.equal(r.continuation(g,[1,2,4],1),false);
});
test('symmetric Y stays visible',()=>assert.equal(r.continuation(r.graph(junction([[-12,20],[12,20]])),[1,2,3],1),false));
test('clearly gentler branch follows the road',()=>assert.equal(r.continuation(r.graph(junction([[12,20],[-20,0]])),[1,2,3],1),true));
test('explicit width continuity can distinguish a Y',()=>{
  const d=junction([[-12,20],[12,20]],{width:'4'});d.ways[2].tags.width='2';
  assert.equal(r.continuation(r.graph(d),[1,2,3],1),true);
  assert.equal(r.continuation(r.graph(d),[1,2,4],1),false);
});
test('explicit surface continuity can distinguish a Y',()=>{
  const d=junction([[-12,20],[12,20]],{surface:'asphalt'});d.ways[2].tags.surface='gravel';
  assert.equal(r.continuation(r.graph(d),[1,2,3],1),true);
});
test('missing width information does not invent a preference',()=>{
  const d=junction([[-12,20],[12,20]],{width:'4'});delete d.ways[2].tags.width;
  assert.equal(r.continuation(r.graph(d),[1,2,3],1),false);
});
test('visible private branch and stop signs keep a frame',()=>{
  const d=junction([[0,20],[20,0]]);d.ways[2].tags.access='private';
  assert.equal(r.continuation(r.graph(d),[1,2,3],1),false);
  delete d.ways[2].tags.access;d.nodes[1].tags={highway:'stop'};
  assert.equal(r.continuation(r.graph(d),[1,2,3],1),false);
});
test('U-turns and route endpoints stay visible',()=>{
  const g=r.graph(junction([[0,20],[20,0]]));
  assert.equal(r.continuation(g,[1,2,1],1),false);
  assert.equal(r.continuation(g,[2,3],0),false);
});
test('filter keeps CP, edits, endpoints; renumbers and recalculates intervals without changing originals',()=>{
  const frames=Array.from({length:6},(_,i)=>({id:String(i),number:i+1,at:i*100,canOmit:true,...shape([180,30+i*35,60+i*35]),checkpoints:i===2?[{name:'CP'}]:[]}));
  const filtered=r.selectFrames(frames,'reduced',{'3':{images:{a:'photo'}}});
  assert.deepEqual(filtered.map(f=>f.id),['0','2','3','5']);
  assert.deepEqual(filtered.map(f=>f.number),[1,2,3,4]);
  assert.deepEqual(filtered.map(f=>f.fromPrevious),[0,200,100,200]);
  assert.equal(r.selectFrames(frames,'all').length,6);assert.equal(frames[5].number,6);
});
test('legacy frames without classification are never omitted',()=>assert.equal(r.selectFrames([{id:'a'},{id:'b'},{id:'c'}],'reduced').length,3));
test('landmarks inside 10m are attached; outside 10m are excluded; signs keep their 28m radius',()=>{
  const d=junction([[0,20],[20,0]]);
  d.places=[{id:'near',name:'近い看板',lat:9.9/111195,lon:0,tags:{tourism:'information',information:'board'}},{id:'far',name:'遠い看板',lat:10.1/111195,lon:0,tags:{tourism:'information',information:'board'}}];
  d.signs=[{id:99,lat:20/111195,lon:0,tags:{highway:'stop'}}];
  const result=r.generate(d,[d.nodes[0],d.nodes[2]]);
  assert.deepEqual(result.frames[0].landmarks.map(l=>l.id),['near']);
  assert.equal(result.frames[0].signs.length,1);
});

function shape(degrees, heading=0) {
  return {center:{lat:0,lon:0},heading:heading*Math.PI/180,branches:degrees.map(deg=>[{lat:0,lon:0},{lat:Math.cos(deg*Math.PI/180)*28/111320,lon:Math.sin(deg*Math.PI/180)*28/111320}])};
}
test('similarity respects approach orientation and does not mirror a T',()=>{
  assert.equal(r.similarJunctions(shape([180,0,90]),shape([270,90,180],90)),true);
  assert.equal(r.similarJunctions(shape([180,0,90]),shape([180,0,-90])),false);
  assert.equal(r.similarJunctions(shape([180,0,90]),shape([180,0,90],90)),false);
});
test('different road counts never match; unknown counts remain conservative',()=>{
  assert.equal(r.similarJunctions(shape([180,0,90]),shape([180,0,90,-90])),false);
  assert.equal(r.similarJunctions({},shape([180,0,90])),true);
});
test('a straight omitted junction matching the next turn is restored with a reason',()=>{
  const frames=[{id:'start',at:0,canOmit:false,...shape([180,-60,60])},{id:'early',at:100,canOmit:true,...shape([180,0,90])},{id:'turn',at:200,canOmit:false,label:'右へ進む',...shape([180,0,90])}];
  const selected=r.selectFrames(frames,'reduced');assert.equal(selected.length,3);assert.match(selected[1].retentionReason,/右へ進む/);assert.equal(frames[1].retentionReason,undefined);
});
test('lookahead repeats after splitting intervals, including straight target frames',()=>{
  const frames=[{id:'start',at:0,canOmit:false,...shape([180,-60,-90])},...[0,15,30,45].map((a,i)=>({id:String(i),at:100+i*100,canOmit:i<3,label:'直進',...shape([180,a,90])}))];
  const selected=r.selectFrames(frames,'reduced');assert.equal(selected.length,5);assert.ok(selected.slice(1,-1).every(f=>f.retentionReason));
});
test('waypoint order fixes endpoints, greedily selects the first half, shuffles only the rest',()=>{
  const pts=[0,8,2,6,1,4,10].map((x,i)=>({id:i,lat:0,lon:x/100,mission:String(i)}));
  const before=JSON.stringify(pts),ordered=r.orderWaypoints(pts,()=>0);
  assert.deepEqual(ordered.map(p=>p.id),[0,4,2,5,3,1,6]);assert.equal(JSON.stringify(pts),before);
  assert.deepEqual([...ordered].map(p=>p.id).sort(),pts.map(p=>p.id).sort());
  assert.equal(ordered[1].mission,'4');assert.deepEqual(r.orderWaypoints(pts.slice(0,2)),pts.slice(0,2));
});
test('mainland sample: both random orders connect, keep five CPs, and have no ambiguous omitted junctions',()=>{
  global.window={};require('../miura-koma-github-pages/data/miura-network.js');const d=global.window.MIURA_NETWORK;delete global.window;
  const first=d.places.find(p=>p.name==='うらり');
  const stops=['見桃寺','海南神社','栄児童公園','宮川神明社','原稲荷神社'].map(name=>({...d.places.find(p=>p.name===name&&p.lat>35.14),checkpoint:true}));
  for(const random of [()=>0,()=>.99]){
    const ordered=r.orderWaypoints([first,...stops,first],random),result=r.generate(d,ordered);
    assert.equal(result.frames.flatMap(f=>f.checkpoints).length+result.unassignedCheckpoints.length,5);
    assert.ok(result.path.every(p=>p.lat>35.14));assert.ok(result.distance>5900&&result.distance<6200);
    const selected=r.selectFrames(result.frames,'reduced'),ids=new Set(selected.map(f=>f.id));let previous=0;
    for(let j=1;j<result.frames.length;j++){
      if(!ids.has(result.frames[j].id))continue;
      for(let i=previous+1;i<j;i++)assert.equal(r.similarJunctions(result.frames[i],result.frames[j]),false);
      previous=j;
    }
    assert.ok(selected.length<result.frames.length);
  }
});

test('three-, four-, and five-way junctions must have matching road counts',()=>{
  const shapes=[shape([180,0,90]),shape([180,0,90,-90]),shape([180,0,90,-90,45])];
  for(let i=0;i<shapes.length;i++)for(let j=0;j<shapes.length;j++)assert.equal(r.similarJunctions(shapes[i],shapes[j]),i===j);
  const missingAngle={...shapes[0],heading:undefined};
  assert.equal(r.similarJunctions(missingAngle,shapes[1]),false);
  assert.equal(r.similarJunctions(missingAngle,shapes[0]),true);
});
test('a three-way junction stays omitted before a four-way target, but not before another three-way target',()=>{
  const start={id:'start',at:0,canOmit:false,...shape([180,-60,60])};
  const early={id:'early',at:100,canOmit:true,...shape([180,0,90])};
  const target={id:'target',at:200,canOmit:false,...shape([180,0,90,-90])};
  assert.deepEqual(r.selectFrames([start,early,target],'reduced').map(f=>f.id),['start','target']);
  assert.equal(r.selectFrames([start,early,{...target,...shape([180,0,90])}],'reduced').length,3);
  assert.equal(r.selectFrames([start,early,target],'all').length,3);
});
test('Suwa shrine, Gozu Kannon and Mukogasaki Park connect with five CPs in all 24 tail orders',()=>{
  global.window={};delete require.cache[require.resolve('../miura-koma-github-pages/data/miura-network.js')];
  require('../miura-koma-github-pages/data/miura-network.js');const d=global.window.MIURA_NETWORK;delete global.window;
  const first=d.places.find(p=>p.name==='うらり');
  const stops=['見桃寺','海南神社','栄児童公園','宮川神明社','原稲荷神社'].map(name=>({...d.places.find(p=>p.name===name&&p.lat>35.14),checkpoint:true}));
  const additions=['w395998661','n3988006045','w395998645'].map(id=>d.places.find(p=>p.id===id));
  const ordered=r.orderWaypoints([first,...stops,...additions,first],()=>.99),head=ordered.slice(0,5),tail=ordered.slice(5,-1);
  const permutations=a=>a.length?a.flatMap((v,i)=>permutations(a.filter((_,j)=>j!==i)).map(p=>[v,...p])):[[]];
  for(const perm of permutations([0,1,2,3])){
    const locations=[...head,...perm.map(i=>tail[i]),first],result=r.generate(d,locations);
    assert.equal(locations.length,10);assert.ok(additions.every(p=>locations.some(l=>l.id===p.id)));
    assert.equal(locations.filter(l=>l.checkpoint).length,5);
    assert.equal(result.frames.flatMap(f=>f.checkpoints).length+result.unassignedCheckpoints.length,5);
    assert.ok(result.snapped.every(p=>p.offset<30));assert.ok(result.path.every(p=>p.lat>35.1395));
    assert.ok(result.distance>6000&&result.distance<15000);
  }
});
