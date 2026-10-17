# 開発者用 蛾レンダラー

`dev/moth_exporter.html` をHTTPサーバー経由で直接開く。一般向けメニューへのリンクはない。
Genome単体のschema_version: 1 JSONを貼り付けるかファイル選択し、プレビュー生成後にPNG/JSONを保存する。
背景（透明・アイボリー・葉1・葉2・樹皮）は表示専用。PNGは128×128px、背景なし。
JSONを編集すると前の出力は無効になる。保存データ・ブラウザストレージにはアクセスしない。

## API

```js
import {parseGenome, renderImageData, renderToCanvas, toPNG} from './js/moth_renderer.mjs';
const genome = parseGenome(jsonText); // オブジェクトも受け付ける。入力を変更しない
const pixels = await renderImageData(genome); // ImageData 128×128
const canvas = await renderToCanvas(genome); // 独立したCanvas
const png = await toPNG(genome); // image/png Blob
```

ブラウザ用ES module。設定JSONとmask_data.jsを既存の相対配置で配信する必要がある。
初回のみcontinuous_v1/config.jsonと輪郭を初期化し、以後は再利用する。
描画関数はCalibration Labからそのまま複製したもの。元のゲーム・Labのコードは変更しない。
CanvasのPNG化に伴う半透明画素の丸めはCalibration Labの同じCanvas経路と比較する。

## 検証

`NODE_PATH=<playwrightがあるnode_modules> node tests/moth_exporter.test.cjs`
ChromeはmacOSの標準インストールパスを使用。別の環境ではCHROME_PATHで指定。
テストは127.0.0.1の一時ポートを使用し、終了後に閉じる。
既存42 GenomeでLab関数とRGBA全バイト一致、PNGデコード結果一致、透明画素、寸法、入力不変性を確認。
葉1・葉2・樹皮の背景変更後にPNGをダウンロードし、背景によるPNG差分がないことも確認。
この背景テストは指定の3個体の検証とは別。既存seedにはbark_001/sand_001のみがあり、
ユーザー指定の葉1・葉2・樹皮3個体のJSONによる最終確認は、対象ファイル提供後に実施する。
