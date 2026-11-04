# 三浦港 コマ地図メーカー

ZIPを解凍し、中身のファイルとdataフォルダをリポジトリ直下にアップロードします。
Settings → Pages → Deploy from a branch → main → /(root) → Save で公開します。

出発地・目的地・経由地から、交差点だけのコマ地図を生成します。CPとミッション、交差点付近の登録済み看板・史跡などに対応します。
コマ地図の生成にはインストールやAPIキーは不要です。

## Google Street View画像

OSM登録済みの目印・道路標識の「画像」リンクで確認画面を開きます。
画像表示には、課金設定とStreet View Static APIを有効にしたGoogle CloudのAPIキーが必要です。
APIキーはブラウザの確認画面に入力します。コードやGitHub、JSONに書き込まないでください。
ブラウザ用APIキーはウェブサイト制限とStreet View Static APIのAPI制限を設定し、日次の割り当て上限も確認してください。
https://developers.google.com/maps/documentation/streetview/get-api-key
https://developers.google.com/maps/documentation/streetview/usage-and-billing

画像はGoogleから必要なときに表示します。画像は保存データやPDFに含めません。
OSMで位置が登録されていても、その看板が画像に写っているとは限りません。

設定と作成した地図はブラウザ内に保存されます。公開先を移す場合は旧アプリで「データ保存」、新アプリで「読み込む」を使います。
各利用者の設定を他の利用者と自動共有する機能はありません。

地図データ: © OpenStreetMap contributors, ODbL 1.0
https://www.openstreetmap.org/copyright
