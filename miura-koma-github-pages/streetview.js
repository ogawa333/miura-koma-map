(function(root){
  'use strict';
  const ID=/^[nw][1-9]\d*$/;
  const finitePoint=p=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;
  function registry(data,routing){
    const entries=new Map();
    for(const p of data.places||[]){
      const info=routing.landmarkInfo(p);
      if(!ID.test(String(p.id))||!finitePoint(p)||!info)continue;
      const token='landmark:'+p.id;
      entries.set(token,Object.freeze({token,id:p.id,name:String(p.name||info.category),category:info.category,lat:p.lat,lon:p.lon,osmURL:'https://www.openstreetmap.org/'+(p.id[0]==='n'?'node/':'way/')+p.id.slice(1)}));
    }
    for(const p of data.signs||[]){
      const info=routing.signOf(p),id='n'+p.id;
      if(!info||!ID.test(id)||!finitePoint(p))continue;
      const token='sign:'+id;
      entries.set(token,Object.freeze({token,id,name:info.label+(info.code?' '+info.code:''),category:'道路標識・信号',lat:p.lat,lon:p.lon,osmURL:'https://www.openstreetmap.org/node/'+p.id}));
    }
    return entries;
  }
  function viewerURL(entries,kind,id){
    const token=kind+':'+id;
    return entries.has(token)?'streetview.html?'+new URLSearchParams({target:token}):null;
  }
  function imageURL(entries,token,key,options={}){
    const target=entries.get(token);
    if(!target)throw new Error('OpenStreetMapで登録を確認できた目印だけが画像取得の対象です。');
    key=String(key||'').trim();
    if(!/^[A-Za-z0-9_-]{20,200}$/.test(key))throw new Error('Street View Static APIのAPIキーを入力してください。');
    const fov=Number(options.fov??70),pitch=Number(options.pitch??0);
    if(!Number.isFinite(fov)||fov<30||fov>100||!Number.isFinite(pitch)||pitch< -20||pitch>40)throw new Error('画角または上下角度の設定が範囲外です。');
    const query=new URLSearchParams({size:'640x400',location:target.lat+','+target.lon,fov:String(fov),pitch:String(pitch),radius:'50',source:'outdoor',return_error_code:'true',key});
    if(options.heading!==undefined&&options.heading!=='auto'){
      const heading=Number(options.heading);
      if(!Number.isFinite(heading)||heading<0||heading>360)throw new Error('向きは0〜360度で指定してください。');
      query.set('heading',String(heading));
    }
    // No heading means Google aims from its nearest panorama toward the OSM location.
    return 'https://maps.googleapis.com/maps/api/streetview?'+query;
  }
  const api={registry,viewerURL,imageURL};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.KomaStreetView=api;
})(typeof window==='undefined'?globalThis:window);
