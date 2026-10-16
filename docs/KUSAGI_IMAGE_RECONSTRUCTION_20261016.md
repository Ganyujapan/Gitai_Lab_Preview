# クサギ背景のPNGアセット

写真由来の背景 `bg_kusagi_720x1280_01.png` は、元々90×160ドットを8倍に拡大した720×1280のピクセルアートです。

`bg_kusagi_source_90x160.png` は元画像と**画素が厳密に一致する**最小単位のPNGで、元の90×160色グリッドを無損失で保存しています。
`python3 scripts/expand_kusagi_background.py` で720×1280 PNGをいつでも復元できます。Python標準ライブラリのみを使用します。

このコードは開発環境で元の `bg_kusagi_720x1280_01.png` と復元後の**全921,600画素がRGB一致**することを検証済みです。
GitHub Pagesの公開処理では必ず復元処理を実行します。GitHub Actionsのmaterialize workflowは同じ全画素一致のPNGをリポジトリ内にも保存します。
旧樹皮・旧砂地画像の実ファイルと過去の評価データは一切変更しません。
