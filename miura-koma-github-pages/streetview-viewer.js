(function(){
  'use strict';
  const $=id=>document.getElementById(id),api=window.KomaStreetView;
  const entries=api.registry(window.MIURA_NETWORK,window.KomaRouting);
  let activeKey='',pendingImage=null,timer=null;
  const requested=new URLSearchParams(location.search).get('target')||'';
  for(const entry of [...entries.values()].sort((a,b)=>a.name.localeCompare(b.name,'ja'))){const option=document.createElement('option');option.value=entry.token;option.textContent=entry.name+' · '+entry.category+' ('+entry.id+')';$('imageTarget').append(option);}
  function clearDisplayed(){
    clearTimeout(timer);
    if(pendingImage){pendingImage.onload=null;pendingImage.onerror=null;pendingImage.removeAttribute('src');pendingImage=null;}
    $('streetImage').onload=null;$('streetImage').onerror=null;$('streetImage').removeAttribute('src');$('imageFigure').hidden=true;
    $('loadImage').disabled=!entries.has($('imageTarget').value);
  }
  function selected(){
    clearDisplayed();const target=entries.get($('imageTarget').value);
    $('osmSource').hidden=!target;$('googleInspect').hidden=!target;
    if(!target){$('targetBadge').textContent='OSM登録を確認できる目印だけを取得します';$('targetLocation').textContent='';$('imageStatus').textContent='登録された目印を選択してください。';return;}
    $('targetBadge').textContent='✓ OSM登録確認済み · '+target.category;$('osmSource').href=target.osmURL;
    $('targetLocation').textContent=target.name+' / '+target.lat.toFixed(6)+', '+target.lon.toFixed(6);
    $('googleInspect').href='https://www.google.com/maps/@?'+new URLSearchParams({api:'1',map_action:'pano',viewpoint:target.lat+','+target.lon});
    $('imageStatus').textContent='「Googleから画像を表示」を押すと、この目印の周辺画像を取得します。';
  }
  $('imageTarget').value=entries.has(requested)?requested:'';selected();
  if(requested&&!entries.has(requested))$('imageStatus').textContent='指定された目印は同梱OSMデータで登録を確認できません。画像は取得していません。';
  $('imageTarget').onchange=selected;
  for(const id of ['imageHeading','imageFov','imagePitch'])$(id).onchange=()=>{clearDisplayed();$('imageStatus').textContent='向き・画角を変更しました。「Googleから画像を表示」で取得します。';};
  $('imageForm').onsubmit=event=>{
    event.preventDefault();const target=entries.get($('imageTarget').value);
    try{
      const key=$('streetViewKey').value.trim()||activeKey;
      const url=api.imageURL(entries,$('imageTarget').value,key,{heading:$('imageHeading').value,fov:$('imageFov').value,pitch:$('imagePitch').value});
      clearDisplayed();activeKey=key;$('streetViewKey').value='';$('streetViewKey').placeholder='この画面ではAPIキー設定済み（変更時だけ入力）';$('keyState').textContent='APIキーはこの画面のメモリ内で使用中です。ファイルや保存データには含めません。';
      $('loadImage').disabled=true;$('imageStatus').textContent='Googleから周辺画像を取得しています…';
      const img=new Image(640,400);pendingImage=img;img.referrerPolicy='strict-origin-when-cross-origin';
      const fail=()=>{if(pendingImage!==img)return;clearDisplayed();$('imageStatus').textContent='画像を取得できませんでした。周辺に屋外画像がないか、APIキー・API有効化・参照元制限・課金設定などに原因があります。下の設定手順かGoogle ストリートビューで確認してください。';};
      img.onload=()=>{
        if(pendingImage!==img)return;clearTimeout(timer);pendingImage=null;img.onload=null;img.onerror=null;
        // Move the same loaded image node into the page; do not trigger a second request.
        const old=$('streetImage');img.id='streetImage';img.alt=target.name+'の登録位置周辺のGoogle Street View画像';old.replaceWith(img);
        $('imageCaption').textContent=target.name+'の周辺画像。画像内の目印は目視で確認してください。';$('imageFigure').hidden=false;$('loadImage').disabled=false;$('imageStatus').textContent='周辺画像を表示しました。看板の位置・文字・見え方を確認してください。';
      };
      img.onerror=fail;timer=setTimeout(fail,25000);img.src=url;
    }catch(error){$('imageStatus').textContent=error.message;}
  };
  $('clearImage').onclick=()=>{clearDisplayed();activeKey='';$('streetViewKey').value='';$('streetViewKey').placeholder='Google Cloudで発行したブラウザ用APIキー';$('keyState').textContent='画像と、この画面で使用していたAPIキーを消去しました。';$('imageStatus').textContent='APIキーを入力し直すと画像を取得できます。';};
  $('referrerExample').textContent=location.protocol==='https:'?location.origin+'/*':'https://あなたの公開先ドメイン/*';
})();
