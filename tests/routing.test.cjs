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
  const frames=Array.from({length:6},(_,i)=>({id:String(i),number:i+1,at:i*100,canOmit:true,checkpoints:i===2?[{name:'CP'}]:[]}));
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
