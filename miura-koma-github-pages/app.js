(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ENGINE = window.KomaRouting, STORAGE = 'miura-komachizu-v2';
  const photoRegistry=window.KomaStreetView?window.KomaStreetView.registry(window.MIURA_NETWORK||{},ENGINE):new Map();
  let data = window.MIURA_NETWORK, result = null, edits = {}, locations = [], searchPlaces = [], pickIndex = null, editingFrame = null, toastTimer;
  let draftImages = {}, imageLoad = 0;
  let view = null, base = null, mapDrag = null, dirty = false, legacyResult = null;
  const typeLabels = {start:'START',goal:'GOAL',via:'経由地',junction:'交差点',bend:'曲がり角',continue:'道なり'};
  function notify(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3000); }
  function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
  function settings() { return {name:$('routeName').value.trim() || '三浦港まち歩き', maxGap:0,mode:'junctions',landmarkEvery:3,autoLandmarks:$('autoLandmarks').checked}; }
  function save() { try {localStorage.setItem(STORAGE, JSON.stringify({version:4,locations,settings:settings(),edits,result,dirty})); $('saveState').textContent = '変更を保存しました';} catch { $('saveState').textContent = '自動保存できません。データ保存をご利用ください'; } }
  function invalidate() {dirty = true; $('generateButton').textContent = '↗ 設定したコースで再生成'; status('設定を変更しました。「自動生成」で地図を更新してください。'); updateGoogleLink(); save(); }
  function initializePlaces() {
    const counts = new Map(); for (const p of data.places) counts.set(p.name, (counts.get(p.name) || 0) + 1);
    searchPlaces = data.places.map(p => ({...p,value:counts.get(p.name) > 1 ? `${p.name} (${p.lat.toFixed(5)}, ${p.lon.toFixed(5)})` : p.name})).sort((a,b) => a.name.localeCompare(b.name,'ja'));
    $('placeList').innerHTML = searchPlaces.map(p => `<option value="${esc(p.value)}"></option>`).join('');
    $('dataInfo').textContent = `${formatDate(data.timestamp)}取得 · 道路 ${data.ways.length.toLocaleString()}本 / 標識・信号 ${data.signs.length}地点。対象範囲内で利用できます。`;
    $('printSource').textContent = `道路データ取得日：${formatDate(data.timestamp)}`;
    base = {lat: data.bounds.north,lon: data.bounds.west,cos:Math.cos((data.bounds.north + data.bounds.south) * Math.PI / 360)};
  }
  function formatDate(s) {const d = new Date(s); return Number.isNaN(d.getTime()) ? '日付不明' : d.toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo'});}
  function findPlace(names) {for (const name of names) {const exact = searchPlaces.find(p=>p.name===name); if(exact)return {...exact}; const partial=searchPlaces.find(p=>p.name.includes(name)); if(partial)return {...partial};} return null;}
  function presets() {
    const first=findPlace(['うらり','三崎港']);
    const shrine=searchPlaces.find(p=>p.name==='海南神社'&&p.lat>35.14&&p.tags?.amenity==='place_of_worship')||findPlace(['海南神社']);
    const park=searchPlaces.find(p=>p.name==='城ヶ島公園'&&p.tags?.leisure==='park')||findPlace(['城ヶ島公園']);
    const eastLight=searchPlaces.find(p=>p.name==='安房崎灯台'&&p.tags?.man_made==='lighthouse');
    const horseRock=searchPlaces.find(p=>p.name==='馬の背洞門'&&p.tags?.information==='board')||findPlace(['馬の背洞門']);
    const westLight=searchPlaces.find(p=>p.name==='城ヶ島灯台'&&p.tags?.man_made==='lighthouse');
    const westPort=searchPlaces.find(p=>p.name==='城ヶ島'&&p.tags?.highway==='bus_stop');
    const northPort=searchPlaces.find(p=>p.name==='白秋碑前'&&p.tags?.public_transport==='stop_position');
    const fallback = searchPlaces.find(p => ENGINE.distance(p, {lat:35.138,lon:139.62}) < 400);
    // Continue beyond the original park finish, then return after the island circuit.
    return [first || fallback, shrine, park, eastLight, horseRock, westLight, westPort, northPort, park].filter(Boolean).map(p=>({name:p.name,lat:p.lat,lon:p.lon,...(p===shrine?{checkpoint:true,mission:'神社の名前を案内板で確かめ、読み方と境内で見つけた特徴を1つ記録しよう。'}:{})}));
  }

  function defaultMission(name='') {return /神社|寺|神宮/.test(name)?'案内板でこの場所の名前と読み方を確かめ、見つけた特徴を1つ記録しよう。':'この場所の案内板を確認し、見つけたことを1つ記録しよう。';}
  function checkpointNumber(index) {return locations.slice(0,index+1).filter(p=>p.checkpoint).length;}
  function locationName(index) { return index === 0 ? 'スタート' : index === locations.length - 1 ? 'ゴール' : `経由地 ${index}`; }
  function renderLocations() {
    $('locationFields').innerHTML = locations.map((p, i) => `<div class="location-block ${p.checkpoint?'checkpoint-location':''}"><label class="field-label location-label" for="location${i}"><i class="dot ${i===0?'start-dot':i===locations.length-1?'goal-dot':'via-dot'}"></i>${locationName(i)}${p.checkpoint?`<span class="cp-badge">CP ${checkpointNumber(i)}</span>`:''}</label><div class="location-input"><input id="location${i}" data-location="${i}" list="placeList" placeholder="地名を選択 / 緯度, 経度" value="${esc(p.name || '')}" autocomplete="off"><button type="button" data-pick="${i}" title="${locationName(i)}を地図で指定" aria-label="${locationName(i)}を地図で指定" class="${pickIndex===i?'active':''}">⌖</button>${i>0&&i<locations.length-1?`<button type="button" data-remove="${i}" class="remove-via" aria-label="経由地を削除">×</button>`:''}</div><div class="location-coordinate ${Number.isFinite(p.lat)?'':'invalid'}">${Number.isFinite(p.lat)?`${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`:'一覧から選択するか、⌖ で地図を指定'}</div><label class="checkbox checkpoint-toggle"><input type="checkbox" data-checkpoint="${i}" ${p.checkpoint?'checked':''}>チェックポイントにする</label>${p.checkpoint?`<label class="field-label" for="mission${i}">CP ${checkpointNumber(i)} のミッション</label><textarea id="mission${i}" data-mission="${i}" rows="3" maxlength="500" placeholder="例：案内板を読んで、神社の名前と読み方を記録しよう。">${esc(p.mission||'')}</textarea>`:''}</div>`).join('');
    $('locationFields').querySelectorAll('[data-location]').forEach(input => {
      input.addEventListener('input', () => {const i=Number(input.dataset.location);locations[i]={...locations[i],name:input.value,lat:undefined,lon:undefined};dirty=true;input.parentElement.nextElementSibling.textContent='一覧から地点を選択してください';input.parentElement.nextElementSibling.classList.add('invalid');status('地点を選択するか、地図で位置を指定してください。');});
      input.addEventListener('change', () => resolveLocation(input));
    });
    $('locationFields').querySelectorAll('[data-pick]').forEach(button=>button.onclick=()=>{pickIndex=pickIndex===Number(button.dataset.pick)?null:Number(button.dataset.pick);renderLocations();updatePickHint();});
    $('locationFields').querySelectorAll('[data-remove]').forEach(button=>button.onclick=()=>{locations.splice(Number(button.dataset.remove),1);pickIndex=null;renderLocations();drawMap();updatePickHint();invalidate();});
    $('locationFields').querySelectorAll('[data-checkpoint]').forEach(input=>input.onchange=()=>{const p=locations[Number(input.dataset.checkpoint)];p.checkpoint=input.checked;if(p.checkpoint&&!p.mission)p.mission=defaultMission(p.name);renderLocations();drawMap();invalidate();});
    $('locationFields').querySelectorAll('[data-mission]').forEach(input=>input.oninput=()=>{const index=Number(input.dataset.mission);locations[index].mission=input.value;if(result&&!dirty){for(const cp of [...result.frames.flatMap(f=>f.checkpoints||[]),...(result.unassignedCheckpoints||[])])if(cp.locationIndex===index)cp.mission=input.value.trim()||defaultMission(locations[index].name);result.locations=structuredClone(locations);renderBook();}save();});
    updateGoogleLink();
  }
  function resolveLocation(input) {
    const index=Number(input.dataset.location), text=input.value.trim();
    let p=searchPlaces.find(p=>p.value===text || p.name===text);
    const coord=text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,、]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if(coord)p={lat:Number(coord[1]),lon:Number(coord[2]),name:`地点 (${Number(coord[1]).toFixed(5)}, ${Number(coord[2]).toFixed(5)})`};
    if(!p){locations[index]={...locations[index],name:text,lat:undefined,lon:undefined};renderLocations();status('入力した地名の位置が未確定です。一覧から選ぶか、⌖ で地図を指定してください。',true);return;}
    if(!inBounds(p)){status('この地点は同梱データの範囲外です。三崎港・城ヶ島周辺の地点を選んでください。',true);return;}
    locations[index]={...locations[index],name:p.name,lat:p.lat,lon:p.lon};pickIndex=null;renderLocations();drawMap();updatePickHint();invalidate();
  }
  function inBounds(p){return p.lat>=data.bounds.south&&p.lat<=data.bounds.north&&p.lon>=data.bounds.west&&p.lon<=data.bounds.east;}
  function updatePickHint() {$('mapStage').classList.toggle('picking',pickIndex!==null);$('mapPickHint').textContent=pickIndex===null?'ドラッグで移動 · ＋ / − で拡大縮小':`${locationName(pickIndex)}を地図上の道路で指定 · もう一度 ⌖ で解除`;}
  function updateGoogleLink() {
    const valid=locations.filter(p=>Number.isFinite(p.lat));
    if(valid.length<2){$('googleLink').href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent('三崎港 神奈川県三浦市');return;}
    const pos=p=>`${p.lat},${p.lon}`;
    const q=new URLSearchParams({api:'1',origin:pos(valid[0]),destination:pos(valid.at(-1)),travelmode:'walking'});
    if(valid.length>2)q.set('waypoints',valid.slice(1,-1).map(pos).join('|'));
    $('googleLink').href='https://www.google.com/maps/dir/?'+q;
  }
  async function generate(quiet=false) {
    if(!data||!ENGINE){status('道路データを読み込めません。ファイルをすべて同じフォルダに置いてください。',true);return;}
    if(locations.some(p=>!Number.isFinite(p.lat))){status('スタート・経由地・ゴールを一覧または地図から指定してください。',true);return;}
    const button=$('generateButton');button.disabled=true;button.textContent='道路網から経路を計算しています…';status('交差点の形と標識を確認しています…');
    await new Promise(resolve=>setTimeout(resolve,30));
    try {
      const config=settings(), started=performance.now();
      const next=ENGINE.generate(config.autoLandmarks?data:{...data,places:[]},locations,config);
      const previous=result||legacyResult;
      if(previous)for(const old of previous.frames||[]){const edit=edits[old.id];if(!edit)continue;const match=next.frames.find(f=>ENGINE.distance(f.center,old.center)<1.5&&Math.abs(f.at-old.at)<5);if(match&&!edits[match.id])edits[match.id]=edit;}
      legacyResult=null;
      result={...next,name:config.name,locations:structuredClone(locations),settings:config};dirty=false;
      renderBook();fitMap();save();
      const offset=next.snapped.filter(s=>s.offset>40);
      status(`${result.frames.length}コマを生成しました。${offset.length?` ${offset.length}地点を近くの道路へ補正しました。`:''}`);
      $('snapInfo').textContent=`道路までの補正：最大 ${Math.round(Math.max(...next.snapped.map(s=>s.offset)))} m`;
      if(!quiet)notify(`${result.frames.length}コマの地図を生成しました`);
      console.info('Koma route generated',{frames:next.frames.length,distance:Math.round(next.distance),milliseconds:Math.round(performance.now()-started)});
    } catch(error){status(error.message,true);} finally {button.disabled=false;button.innerHTML='<span>↗</span> コマ地図を自動生成';}
  }
  function projected(p) {return {x:(p.lon-base.lon)*111320*base.cos,y:(base.lat-p.lat)*111320};}
  function unprojected(p) {return {lat:base.lat-p.y/111320,lon:base.lon+p.x/(111320*base.cos)};}
  function linePath(points) {return points.map((p,i)=>{const q=projected(p);return `${i?'L':'M'}${q.x.toFixed(2)},${q.y.toFixed(2)}`;}).join('');}
  function fitMap() {
    if(!data)return;
    const ps=result?.path?.length?result.path:locations.filter(p=>Number.isFinite(p.lat));
    const all=ps.length>1?ps:[{lat:data.bounds.south,lon:data.bounds.west},{lat:data.bounds.north,lon:data.bounds.east}];
    const coords=all.map(projected), xs=coords.map(p=>p.x),ys=coords.map(p=>p.y);
    const width=Math.max(...xs)-Math.min(...xs),height=Math.max(...ys)-Math.min(...ys),ratio=$('mapStage').clientWidth/Math.max(1,$('mapStage').clientHeight);
    let w=Math.max(550,width+250,height*ratio+250),h=w/ratio;
    view={x:(Math.min(...xs)+Math.max(...xs)-w)/2,y:(Math.min(...ys)+Math.max(...ys)-h)/2,width:w,height:h};drawMap();
  }
  function setView() {if(view)$('areaMap').setAttribute('viewBox',`${view.x} ${view.y} ${view.width} ${view.height}`);}
  function drawMap() {
    if(!data||!base||!view)return;
    const nodeMap=new Map(data.nodes.map(n=>[n.id,n]));
    const roads={major:[],minor:[],path:[]};
    for(const way of data.ways){const t=way.tags||{};if(/^(construction|proposed)$/.test(t.highway))continue;const points=way.nodes.map(i=>nodeMap.get(i)).filter(Boolean);if(points.length<2)continue;const type=/^(primary|secondary|tertiary)/.test(t.highway)?'major':/^(path|footway|steps|pedestrian)$/.test(t.highway)?'path':'minor';roads[type].push(linePath(points));}
    const background=(data.context||[]).map(w=>{const pts=w.points.map(p=>({lat:p[0],lon:p[1]})),closed=w.points.length>2&&w.points[0][0]===w.points.at(-1)[0]&&w.points[0][1]===w.points.at(-1)[1];const water=w.tags.natural==='water'||!!w.tags.waterway;const coast=w.tags.natural==='coastline';return `<path d="${linePath(pts)}" fill="${closed?(water?'#c9dfe0':'#d7e0c9'):'none'}" stroke="${coast?'#97bfc2':water?'#c2dade':'none'}" stroke-width="${coast?2:1}" vector-effect="non-scaling-stroke"/>`;}).join('');
    const route=result?`<path d="${linePath(result.path)}" fill="none" stroke="#fffdf2" stroke-width="8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><path d="${linePath(result.path)}" fill="none" stroke="#37654d" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`:'';
    const unit=view.width/Math.max(1,$('mapStage').clientWidth), selected=[];
    const prominent=searchPlaces.filter(p=>p.tags?.tourism||p.tags?.historic||p.tags?.leisure==='park'||['place_of_worship','school','townhall','marketplace'].includes(p.tags?.amenity));
    for(const p of prominent){const q=projected(p);if(q.x<view.x||q.x>view.x+view.width||q.y<view.y||q.y>view.y+view.height)continue;if(selected.some(s=>Math.hypot(s.q.x-q.x,s.q.y-q.y)<80*unit))continue;selected.push({p,q});if(selected.length>=20)break;}
    const labels=selected.map(({p,q})=>`<text x="${q.x}" y="${q.y}" font-size="${10*unit}" text-anchor="middle" fill="#76836f" stroke="#edf0e5" stroke-width="${3*unit}" paint-order="stroke" style="pointer-events:none">${esc(p.name)}</text>`).join('');
    const pins=locations.filter(p=>Number.isFinite(p.lat)).map(p=>{const i=locations.indexOf(p),q=projected(p),letter=i===0?'S':i===locations.length-1?'G':p.checkpoint?'CP'+checkpointNumber(i):String(i),color=i===0?'#32614d':i===locations.length-1?'#b97051':'#b68b37';return `<g><circle cx="${q.x}" cy="${q.y}" r="${12*unit}" fill="${color}" stroke="#fffef6" stroke-width="${2*unit}"/><text x="${q.x}" y="${q.y+3.5*unit}" text-anchor="middle" font-size="${(p.checkpoint&&i>0&&i<locations.length-1?8:10)*unit}" fill="white" font-weight="700">${letter}</text></g>`;}).join('');
    $('areaMap').innerHTML=`<rect x="-20000" y="-20000" width="50000" height="50000" fill="#e9ece2"/>${background}<g fill="none" stroke-linejoin="round" stroke-linecap="round"><path d="${roads.minor.join('')}" stroke="#cdd1c2" stroke-width="5" vector-effect="non-scaling-stroke"/><path d="${roads.minor.join('')}" stroke="#fbfaf3" stroke-width="3.3" vector-effect="non-scaling-stroke"/><path d="${roads.major.join('')}" stroke="#c9cdbd" stroke-width="8" vector-effect="non-scaling-stroke"/><path d="${roads.major.join('')}" stroke="#fffef5" stroke-width="6" vector-effect="non-scaling-stroke"/><path d="${roads.path.join('')}" stroke="#d1d5c5" stroke-width="2" stroke-dasharray="3 2" vector-effect="non-scaling-stroke"/></g>${labels}${route}${pins}`;setView();
  }
  function zoom(factor) {if(!view)return;const width=Math.max(180,Math.min(15000,view.width*factor)),ratio=width/view.width;view={x:view.x+(view.width-width)/2,y:view.y+(view.height-view.height*ratio)/2,width,height:view.height*ratio};drawMap();}
  function localPoint(event) {const p=$('areaMap').createSVGPoint();p.x=event.clientX;p.y=event.clientY;return p.matrixTransform($('areaMap').getScreenCTM().inverse());}
  function hookMap() {
    $('zoomIn').onclick=()=>zoom(.7);$('zoomOut').onclick=()=>zoom(1.4);$('fitMap').onclick=fitMap;
    const map=$('areaMap');map.addEventListener('pointerdown',event=>{if(!view)return;mapDrag={pointer:event.pointerId,startX:event.clientX,startY:event.clientY,view:{...view},point:localPoint(event),moved:false};map.setPointerCapture(event.pointerId);});
    map.addEventListener('pointermove',event=>{if(!mapDrag||event.pointerId!==mapDrag.pointer)return;const dx=event.clientX-mapDrag.startX,dy=event.clientY-mapDrag.startY;if(Math.hypot(dx,dy)>5)mapDrag.moved=true;if(mapDrag.moved){const rect=map.getBoundingClientRect();view={...mapDrag.view,x:mapDrag.view.x-dx/rect.width*mapDrag.view.width,y:mapDrag.view.y-dy/rect.height*mapDrag.view.height};setView();}});
    map.addEventListener('pointerup',event=>{if(!mapDrag||event.pointerId!==mapDrag.pointer)return;const drag=mapDrag;mapDrag=null;if(drag.moved){drawMap();return;}if(pickIndex===null)return;const p=unprojected(localPoint(event));if(!inBounds(p)){notify('対応範囲内の道路を選んでください');return;}const i=pickIndex;locations[i]={...locations[i],name:`地図で指定 (${p.lat.toFixed(5)}, ${p.lon.toFixed(5)})`,...p};pickIndex=null;renderLocations();updatePickHint();drawMap();invalidate();});
    map.addEventListener('pointercancel',()=>{mapDrag=null;});map.addEventListener('wheel',event=>{if(event.ctrlKey||event.metaKey){event.preventDefault();zoom(event.deltaY>0?1.12:.89);}},{passive:false});
  }
  function photoLink(kind,item){
    if(!window.KomaStreetView||item.source!=='OpenStreetMap')return '';
    const id=kind==='landmark'?String(item.id||''):'n'+String(item.osmId||'');
    const url=window.KomaStreetView.viewerURL(photoRegistry,kind,id);
    return url?`<a class="photo-link organizer-only" href="${esc(url)}" target="_blank" rel="noopener" aria-label="${esc(item.name||item.label||'目印')}のStreet View画像">画像 ↗</a>`:'';
  }
  function frameEdit(f){return edits[f.id]||{};}
  function frameSigns(f){const e=frameEdit(f);return e.signKind?[...f.signs,{kind:e.signKind,label:e.signLabel||(e.signKind==='stop'?'一時停止':e.signKind==='signals'?'信号機':'道路標識'),source:'手動確認',side:e.signSide||'left'}]:f.signs;}
  function frameLandmarks(f){const all=[...(f.landmarks||(f.landmark?[f.landmark]:[]))],manual=frameEdit(f).landmark;if(manual)all.push({name:manual,kind:'building',category:'手動確認',source:'手動確認'});return all;}
  function frameLandmark(f){return frameLandmarks(f)[0]||null;}
  function imageKey(kind,item,index) {return kind+':'+(item.id||item.osmId||'manual-'+index);}
  function safeImage(value) {return typeof value==='string'&&value.length<400000&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);}
  function imageSymbol(f,kind,item,index) {
    const images=editingFrame===f&&$('frameDialog').open?draftImages:frameEdit(f).images;
    const src=images?.[imageKey(kind,item,index)];
    return safeImage(src)?`<rect x="-33" y="-25.5" width="66" height="51" fill="white"/><image class="manual-photo" href="${esc(src)}" x="-33" y="-25.5" width="66" height="51" preserveAspectRatio="xMidYMid meet"/>`:'';
  }
  function imageTargets() {
    return [...frameLandmarks(editingFrame).slice(0,4).map((item,i)=>({key:imageKey('landmark',item,i),label:`目印 ${i+1}：${item.name}`})),...frameSigns(editingFrame).map((item,i)=>({key:imageKey('sign',item,i),label:`標識 ${i+1}：${item.label}`}))];
  }
  function refreshImageEditor() {
    const previous=$('imageTarget').value,targets=imageTargets();
    $('imageTarget').innerHTML=targets.map(t=>`<option value="${esc(t.key)}">${esc(t.label)}</option>`).join('');
    if(targets.some(t=>t.key===previous))$('imageTarget').value=previous;
    $('manualPhoto').disabled=!targets.length;
    $('imageHelp').textContent=targets.length?'差し替える目印・標識を選び、画像を追加してください。画像は保存・印刷に含まれます。':'このコマには目印・標識がありません。目印や標識を追記して保存し、もう一度開いてください。';
    previewImage();
  }
  function previewImage() {
    const src=draftImages[$('imageTarget').value];
    $('photoPreview').hidden=!safeImage(src);
    if(safeImage(src))$('photoPreview').src=src;else $('photoPreview').removeAttribute('src');
    $('removePhoto').disabled=!safeImage(src);
    $('editDiagram').innerHTML=diagram(editingFrame,'dialog');
  }
  async function loadManualPhoto(event) {
    const file=event.target.files[0],frame=editingFrame,key=$('imageTarget').value,request=++imageLoad;
    event.target.value='';
    if(!file||!key)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){notify('JPEG・PNG・WebPの画像（10MB以下）を選んでください。');return;}
    $('photoStatus').textContent='画像を読み込んでいます…';
    $('saveFrame').disabled=true;
    try {
      const image=await createImageBitmap(file);
      try {
        const ratio=Math.min(1,480/Math.max(image.width,image.height)),canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));
        const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
        const src=canvas.toDataURL('image/jpeg',.8);
        if(!safeImage(src))throw new Error('画像が大きすぎます。別の画像を選んでください。');
        if(request!==imageLoad||editingFrame!==frame||!$('frameDialog').open)return;
        draftImages[key]=src;previewImage();$('photoStatus').textContent='画像を追加しました。「追記を保存」で確定します。';
      }finally{image.close();}
    }catch(error){if(request===imageLoad){$('photoStatus').textContent='画像を読み込めませんでした。';notify(error.message);}}
    finally{if(request===imageLoad)$('saveFrame').disabled=false;}
  }
  function diagram(f, unique) {
    const heading=f.heading, center=f.center, cos=Math.cos(center.lat*Math.PI/180), scale=2.6;
    const point=p=>{const east=(p.lon-center.lon)*111320*cos,north=(p.lat-center.lat)*111320;return {x:110+(east*Math.cos(heading)-north*Math.sin(heading))*scale,y:105-(east*Math.sin(heading)+north*Math.cos(heading))*scale};};
    const path=ps=>ps.map((p,i)=>{const q=point(p);return `${i?'L':'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`;}).join('');
    const incoming=f.routeIn.length?`<path d="${path(f.routeIn)}" fill="none" stroke="#20251f" stroke-width="3.2"/>`:'';
    let incomingArrow='';if(f.routeIn.length){const a=point(f.routeIn[0]),b=point(f.routeIn.at(-1));const x=a.x+(b.x-a.x)*.42,y=a.y+(b.y-a.y)*.42;incomingArrow=`<path d="M${a.x+(b.x-a.x)*.25},${a.y+(b.y-a.y)*.25}L${x},${y}" fill="none" stroke="#20251f" stroke-width="2.5" marker-end="url(#arrow${unique})"/>`;}
    const outgoing=f.routeOut.length?`<path d="${path(f.routeOut)}" fill="none" stroke="#20251f" stroke-width="3.2" marker-end="url(#arrow${unique})"/>`:'';
    const terminal=f.kind==='start'||f.kind==='goal'?'<circle cx="110" cy="105" r="4.2" fill="#20251f"/>':'';
    const signs=frameSigns(f).map((s,i)=>{
      const actual=s.lat?point(s):{x:s.side==='right'?156:64,y:126};let x=Math.max(33,Math.min(187,actual.x)),y=Math.max(32,Math.min(165,actual.y));if(Math.abs(x-110)<26)x+=i%2?-36:36;y+=i*4;
      let symbol;
      if(s.kind==='stop')symbol='<path d="M-13,-11H13L0,12Z" fill="#c14f43" stroke="#a13f37" stroke-width=".7"/><text text-anchor="middle" y="-1" fill="white" font-size="5.6" font-weight="700">止まれ</text>';
      else if(s.kind==='giveway')symbol='<path d="M-13,-11H13L0,12Z" fill="white" stroke="#be5145" stroke-width="3"/>';
      else if(s.kind==='signals')symbol='<rect x="-18" y="-7" width="36" height="14" rx="6" fill="#ecece6" stroke="#647160"/><circle cx="-11" cy="0" r="4" fill="#54896b"/><circle cy="0" r="4" fill="#d2ac42"/><circle cx="11" cy="0" r="4" fill="#bd6552"/>';
      else symbol='<circle r="11" fill="#fffef9" stroke="#516b7c" stroke-width="2"/><text text-anchor="middle" y="3" font-size="9" fill="#516b7c">標</text>';
      symbol=imageSymbol(f,'sign',s,i)||symbol;
      return `<path d="M${actual.x.toFixed(1)},${actual.y.toFixed(1)}L${x.toFixed(1)},${y.toFixed(1)}" stroke="#b7b7a5" stroke-width=".7" stroke-dasharray="2 2"/><g transform="translate(${x},${y})">${symbol}</g>`;
    }).join('');
    const lanes={left:0,right:0};
    const features=frameLandmarks(f).slice(0,4).map((l,i)=>{
      const actual=Number.isFinite(l.lat)?point(l):{x:55,y:95},side=actual.x<108?'left':actual.x>112?'right':i%2?'right':'left';
      const x=side==='left'?33:187,y=42+lanes[side]++*43;
      const kind=l.kind||'building';let shape;
      if(kind==='board')shape='<path d="M0,3V15M-5,15H5"/><rect x="-10" y="-10" width="20" height="13" rx="1"/><path d="M-6,-6H6M-6,-2H3"/>';
      else if(kind==='shrine')shape='<path d="M-12,-8Q0,-4 12,-8M-10,-2H10M-7,-6L-8,14M7,-6L8,14M-10,14H-5M5,14H10"/>';
      else if(kind==='lighthouse')shape='<path d="M-7,14L-4,-7H4L7,14ZM-7,-7L0,-13L7,-7M-10,-11L-15,-14M10,-11L15,-14M-3,1H3"/>';
      else if(kind==='tree')shape='<path d="M-3,3V14H3V3M-10,3Q-17,-5 -8,-8Q-7,-17 1,-13Q11,-17 12,-7Q19,1 10,5Z"/>';
      else if(kind==='memorial')shape='<path d="M-7,12V-7L0,-11L7,-7V12M-11,14H11M-2,-4V7M2,-4V7"/>';
      else shape='<path d="M-10,13V-4L0,-11L10,-4V13ZM-13,13H13M-3,13V4H3V13M-6,-1H-3M3,-1H6"/>';
      return `<path d="M${actual.x.toFixed(1)},${actual.y.toFixed(1)}L${x},${y}" stroke="#95a28e" stroke-width=".7" stroke-dasharray="2 2"/><g transform="translate(${x},${y})"><rect x="-16" y="-22" width="32" height="40" fill="#fffefa" opacity=".94"/><g stroke="#53714e" fill="none" stroke-width="1.15" stroke-linejoin="round">${shape}</g>${imageSymbol(f,'landmark',l,i)}<text x="0" y="-16" text-anchor="middle" font-size="8" font-weight="700" fill="#53714e">${i+1}</text></g>`;
    }).join('');
    return `<svg class="diagram" viewBox="0 0 220 200" role="img" aria-label="${esc(f.label)}のコマ地図。${frameSigns(f).map(s=>esc(s.label)).join('、')}。${frameLandmarks(f).map(l=>esc(l.name)).join('、')}"><defs><marker id="arrow${unique}" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0L7,3L0,6Z" fill="#20251f"/></marker></defs><g stroke="#474d42" stroke-width="1.35" fill="none" stroke-linecap="round" stroke-linejoin="round">${f.branches.map(ps=>`<path d="${path(ps)}"/>`).join('')}</g>${incoming}${incomingArrow}${outgoing}${terminal}${signs}${features}<text x="110" y="188" text-anchor="middle" fill="#b1b5a8" font-size="7">進入方向</text></svg>`;
  }
  function checkpointHTML(cp,withEdit=true) {
    const where=cp.placement==='after'?`この交差点から経路に沿って約${Math.round(cp.offset)}m先のCPで実施`:cp.placement==='before'?`この交差点の約${Math.round(-cp.offset)}m手前のCPで先に実施`:cp.placement==='standalone'?'コース上のCPで実施':'この交差点のCPで実施';
    return `<section class="mission-block"><h3>⚑ CP ${esc(cp.number)} · ${esc(cp.name)}</h3><div class="cp-arrival">${esc(where)}</div><div class="mission-caption">MISSION</div><p>${esc(cp.mission)}</p>${withEdit?`<button type="button" class="text-button organizer-only" data-mission-edit="${cp.locationIndex}">ミッションを編集 ↗</button>`:''}</section>`;
  }
  function renderBook() {
    if(!result)return;
    $('bookTitle').textContent=result.name;
    $('bookSubtitle').textContent='交差点のみを番号順に表示。進入方向は下、黒い矢印が進行方向です。';
    $('routeEnds').textContent=`スタート：${result.locations?.[0]?.name||''}　→　ゴール：${result.locations?.at(-1)?.name||''}`;
    const signs=result.frames.reduce((sum,f)=>sum+frameSigns(f).length,0),landmarks=result.frames.reduce((sum,f)=>sum+frameLandmarks(f).length,0);
    const cps=[...result.frames.flatMap(f=>f.checkpoints||[]),...(result.unassignedCheckpoints||[])];
    $('metrics').hidden=false;$('metrics').innerHTML=`<div class="metric"><small>交差点のコマ</small><strong>${result.frames.length}<span>コマ</span></strong></div><div class="metric"><small>コースの長さ</small><strong>${(result.distance/1000).toFixed(2)}<span>km</span></strong></div><div class="metric"><small>看板・地域の目印</small><strong>${landmarks}<span>件</span></strong></div><div class="metric"><small>チェックポイント</small><strong>${cps.length}<span>か所</span></strong></div>`;
    const groups=[];for(let i=0;i+2<result.frames.length;i+=3)groups.push(result.frames.slice(i,i+3));
    const missing=groups.filter(group=>!group.some(f=>frameSigns(f).length||frameLandmarks(f).length||(f.checkpoints||[]).length)).length;
    $('coverageNotice').hidden=!result.frames.length;$('coverageNotice').classList.toggle('good',!missing);
    $('coverageNotice').textContent=missing?`△ ${groups.length}組中${missing}組で「3コマに1つ」の目印が未確認です。看板・目印は交差点から40m以内の登録データを表示します。見える位置や表示内容は「確認・追記」で確認してください。`:`✓ 交差点付近の看板・地域の目印を${landmarks}件、道路標識・信号を${signs}件表示しています。位置は概略です。`;
    $('frameGrid').innerHTML=result.frames.length?result.frames.map(f=>{
      const marks=frameSigns(f),features=frameLandmarks(f),e=frameEdit(f),cps=f.checkpoints||[],tag=cps.length?cps.map(cp=>'CP '+cp.number).join(' / '):features.length?'目印あり':marks.length?'標識あり':'交差点';
      return `<article class="koma ${cps.length?'checkpoint-koma':''}" id="frame${f.number}"><div class="koma-head"><span class="koma-number">${String(f.number).padStart(3,'0')}</span><span class="type ${features.length||marks.length||cps.length?'marker':''}">${esc(tag)}</span></div>${diagram(f,'card'+f.number)}${cps.map(cp=>checkpointHTML(cp)).join('')}<div class="koma-body"><div class="koma-direction">${esc(f.label)}</div>${marks.length?`<div class="koma-sign">${marks.map(s=>`<span class="sign-chip">${esc(s.label)}${s.code?' '+esc(s.code):''}${photoLink('sign',s)}</span>`).join('')}</div>`:''}${features.map((l,i)=>`<div class="koma-note landmark-note"><b>${i<4?i+1:'◇'}</b><span>${esc(l.name)}<small>${esc(l.category||'確認した目印')}</small></span>${photoLink('landmark',l)}</div>`).join('')}${e.note?`<div class="koma-note">${esc(e.note)}</div>`:''}</div><div class="koma-info"><span>${Math.round(f.at)} m 地点${!marks.length?' · 標識未確認':''}</span><button data-edit="${f.number-1}">確認・追記 ↗</button></div></article>`;
    }).join(''):'<div class="empty-state"><span>→</span><h3>この経路上に交差点はありません</h3><p>直線やカーブのコマは作成しません。<br>スタートから経路に沿ってゴールへ進みます。</p></div>';
    $('checkpointAside').innerHTML=(result.unassignedCheckpoints||[]).map(cp=>checkpointHTML(cp)).join('');
    $('printSource').textContent=`道路データ取得日：${formatDate(result.sourceDate||data.timestamp)} · 目印の記号：▤ 看板 / ⛩ 寺社 / □ 建物・史跡`;
    for(const container of [$('frameGrid'),$('checkpointAside')])container.querySelectorAll('[data-mission-edit]').forEach(button=>button.onclick=()=>{const field=$('mission'+button.dataset.missionEdit);if(field){field.scrollIntoView({behavior:'smooth',block:'center'});field.focus({preventScroll:true});}});
    $('frameGrid').querySelectorAll('[data-edit]').forEach(button=>button.onclick=()=>openFrame(Number(button.dataset.edit)));
  }
  function openFrame(index) {
    const f=result.frames[index];editingFrame=f;const e=frameEdit(f);$('editTitle').textContent=`コマ ${String(f.number).padStart(3,'0')} の確認`;$('editDiagram').innerHTML=diagram(f,'dialog');
    $('streetViewLink').href='https://www.google.com/maps/@?api=1&map_action=pano&viewpoint='+f.center.lat+','+f.center.lon;
    $('manualLandmark').value=e.landmark||'';$('manualSign').value=e.signKind||'';$('manualSignLabel').value=e.signLabel||'';$('signSide').value=e.signSide||'left';$('frameNote').value=e.note||'';draftImages={...e.images};imageLoad++;$('saveFrame').disabled=false;$('manualPhoto').value='';$('photoStatus').textContent='';$('frameDialog').showModal();refreshImageEditor();
  }
  function exportData() {if(dirty){notify('設定が変わっています。自動生成してから保存してください');return;}if(!result){notify('先にコマ地図を生成してください');return;}const payload={format:'miura-koma-roadbook',version:4,locations,settings:settings(),result,edits};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=(result.name||'コマ地図')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('コマ地図と手動追記を保存しました');}
  function validImported(p) {
    return p?.format==='miura-koma-roadbook'&&[2,3,4].includes(p.version)&&Array.isArray(p.locations)&&p.locations.length>=2&&p.locations.length<=12&&p.locations.every(l=>Number.isFinite(l.lat)&&Number.isFinite(l.lon))&&Array.isArray(p.result?.frames)&&p.result.frames.length>=0&&p.result.frames.length<3000&&Array.isArray(p.result?.path)&&p.result.frames.every(f=>Number.isFinite(f.center?.lat)&&Number.isFinite(f.center?.lon)&&Number.isFinite(f.heading)&&Array.isArray(f.branches)&&f.branches.every(a=>Array.isArray(a)&&a.every(q=>Number.isFinite(q.lat)&&Number.isFinite(q.lon)))&&Array.isArray(f.routeIn)&&Array.isArray(f.routeOut)&&Array.isArray(f.signs));
  }
  function applySettings(s) {if(!s)return;$('routeName').value=s.name||'三浦港まち歩き';$('autoLandmarks').checked=s.autoLandmarks!==false;}
  async function refreshData() {
    const button=$('refreshData');button.disabled=true;status('登録済みの道路・標識を取得しています。最大60秒ほどかかります…');
    const b=data.bounds,box=`${b.south},${b.west},${b.north},${b.east}`;
    const query=`[out:json][timeout:40];(way[highway](${box});node[traffic_sign](${box});node["traffic_sign:forward"](${box});node["traffic_sign:backward"](${box});node[highway~"^(stop|give_way|traffic_signals)$"](${box});node[name](${box});node[tourism=information](${box});node[advertising](${box});way[name][amenity](${box});way[name][tourism](${box}););out center body;>;out body qt;`;
    try {
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);let response;
      try{response=await fetch('https://overpass-api.de/api/interpreter?data='+encodeURIComponent(query),{signal:controller.signal,cache:'no-store'});}finally{clearTimeout(timer);}
      if(!response.ok)throw new Error('地図データ提供サーバーが混雑しています。');
      const raw=await response.json();if(raw.remark||!raw.elements?.length)throw new Error('データの取得が完了しませんでした。');
      const nodes=new Map(),ways=[],places=[],signs=[];
      for(const el of raw.elements){if(el.type==='node'){const n=nodes.get(el.id);if(!n||el.tags)nodes.set(el.id,el);}if(el.type==='way'&&el.tags?.highway)ways.push(el);}
      for(const n of nodes.values()){if(ENGINE.signOf(n))signs.push(n);const t=n.tags||{};if(((t['name:ja']||t.name)&&['amenity','tourism','shop','historic','leisure','man_made','place','public_transport','natural'].some(k=>t[k]))||(t.tourism==='information'&&['board','map','guidepost'].includes(t.information))||t.advertising)places.push({...n,id:'n'+n.id,name:t['name:ja']||t.name||({board:'案内看板',map:'観光案内図',guidepost:'案内標柱'}[t.information])||'看板'});}
      for(const w of raw.elements.filter(e=>e.type==='way'&&e.center&&e.tags?.name&&!e.tags?.highway))places.push({id:'w'+w.id,...w.center,name:w.tags['name:ja']||w.tags.name,tags:w.tags});
      if(!ways.length)throw new Error('道路データが含まれていません。');
      data={...data,nodes:[...nodes.values()],ways,places,signs,timestamp:raw.osm3s?.timestamp_osm_base||new Date().toISOString()};initializePlaces();drawMap();status('最新データを取得しました。「自動生成」で経路とコマを更新してください。');notify('道路と標識のデータを更新しました');
    }catch(error){status(`更新できませんでした。同梱の道路データで引き続き生成できます。${error.name==='AbortError'?'取得が時間切れになりました。':error.message}`,true);}finally{button.disabled=false;}
  }
  function start() {
    if(!data||!ENGINE){status('道路データを読み込めません。index.html / app.js / routing.js / data フォルダを一緒に置いて開いてください。',true);return;}
    initializePlaces();
    try {const saved=JSON.parse(localStorage.getItem(STORAGE));if([2,3,4].includes(saved?.version)){locations=saved.locations||[];edits=saved.edits||{};dirty=!!saved.dirty;applySettings(saved.settings);if(Array.isArray(saved.result?.frames)&&saved.result?.path?.length)result=saved.result;if(saved.version===2){locations=locations.map((p,i)=>i>0&&i<locations.length-1&&/神社|寺|神宮/.test(p.name||'')?{...p,checkpoint:true,mission:defaultMission(p.name)}:p);if(locations.some(p=>p.checkpoint))result=null;}if(result&&result.generationVersion!==4){legacyResult=result;result=null;}if(dirty)result=null;}}catch{}
    if(locations.length<2){locations=presets();if(locations.length<2)locations=[{name:''},{name:''}];}
    renderLocations();hookMap();fitMap();if(result){renderBook();status(`${result.frames.length}コマの保存データを復元しました。`);}else status('地名一覧から選ぶか、⌖ で地図上の道路を選択してください。');
    $('routeForm').onsubmit=event=>{event.preventDefault();generate();};
    $('addVia').onclick=()=>{if(locations.length>=12){notify('経由地は10か所まで追加できます');return;}locations.splice(locations.length-1,0,{name:''});pickIndex=locations.length-2;renderLocations();updatePickHint();invalidate();};
    $('addCheckpoint').onclick=()=>{if(locations.length>=12){notify('経由地・CPは合計10か所まで追加できます');return;}locations.splice(locations.length-1,0,{name:'',checkpoint:true,mission:defaultMission()});pickIndex=locations.length-2;renderLocations();updatePickHint();invalidate();};
    $('routeName').addEventListener('input',()=>{if(result){result.name=$('routeName').value||'三浦港まち歩き';$('bookTitle').textContent=result.name;}save();});
    for(const id of ['autoLandmarks'])$(id).onchange=invalidate;
    $('organizerMode').onchange=()=>document.body.classList.toggle('participant',!$('organizerMode').checked);
    $('sampleButton').onclick=()=>{$('routeName').value='三浦港・城ヶ島一周';locations=presets();edits={};pickIndex=null;renderLocations();updatePickHint();generate();};
    $('printButton').onclick=()=>{if(!result){notify('先にコマ地図を生成してください');return;}if(dirty){notify('設定が変わっています。自動生成してから印刷してください');return;}window.print();};
    $('downloadButton').onclick=exportData;$('importButton').onclick=()=>$('fileInput').click();
    $('fileInput').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>15000000)throw new Error('ファイルは15MB以下にしてください。');const p=JSON.parse(await file.text());if(!validImported(p))throw new Error('このアプリで保存したコマ地図ファイルを指定してください。');locations=p.locations;edits=p.edits||{};result=p.result;applySettings(p.settings);dirty=false;pickIndex=null;renderLocations();if(result.generationVersion!==4){legacyResult=result;result=null;await generate(true);}else{renderBook();fitMap();save();}status('コマ地図ファイルを読み込みました。');}catch(e){notify(e.message);}event.target.value='';};
    $('closeDialog').onclick=()=>$('frameDialog').close();
    $('frameDialog').addEventListener('close',()=>{imageLoad++;$('saveFrame').disabled=false;});
    $('imageTarget').onchange=previewImage;
    $('manualPhoto').onchange=loadManualPhoto;
    $('removePhoto').onclick=()=>{imageLoad++;delete draftImages[$('imageTarget').value];previewImage();$('photoStatus').textContent='画像を解除しました。「追記を保存」で確定します。';$('saveFrame').disabled=false;};
    $('frameEditForm').onsubmit=event=>{event.preventDefault();if(!editingFrame)return;edits[editingFrame.id]={landmark:$('manualLandmark').value.trim(),signKind:$('manualSign').value,signLabel:$('manualSignLabel').value.trim(),signSide:$('signSide').value,note:$('frameNote').value.trim(),images:{...draftImages}};$('frameDialog').close();renderBook();save();notify('確認した目印と標識を追記しました');};
    $('clearEdit').onclick=()=>{if(!editingFrame)return;delete edits[editingFrame.id];$('frameDialog').close();renderBook();save();};
    $('refreshData').onclick=refreshData;
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){pickIndex=null;renderLocations();updatePickHint();}});
    let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!view)return;const ratio=$('mapStage').clientWidth/$('mapStage').clientHeight;view.height=view.width/ratio;drawMap();},150);});
    if(!result&&locations.every(p=>Number.isFinite(p.lat)))generate(true);
  }
  start();
})();
