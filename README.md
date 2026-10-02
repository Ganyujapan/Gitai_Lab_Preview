# Gitai_Lab Preview

Gitai_Lab（ギタイラボ）のiPhone / iPad向け公開プレビューです。

Play:

https://ganyujapan.github.io/Gitai_Lab_Preview/

## 現在のPreview条件

- 1世代 = 5ラウンド
- 1ラウンド = 12個体
- 1ラウンド = 2.0秒
- ラウンド間 = 250ms
- ラウンド間の操作画面なし
- 世代終了時に成績発表を表示（1秒あたりの捕食数・歴代順位）
- 同じ捕食数は同順位（その集団が取り得る最も若い順位を表示）
- 歴代20位以内は任意の名前を記録可能
- 「ランキングを見る」で歴代20位以内を表示
- 「世代を比較する」と「次の人へ」を同格のメイン操作として表示
- 生存個体だけから次世代を生成
- 生存0〜1個体は同じ世代を再試行
- 世代終了後に「作者からのお知らせ」を控えめに表示

時間比較:

- `?seconds=2`
- `?seconds=2.5`
- `?seconds=3`
- `?fast=1` = 0.5秒

## 本番実験との分離

このPublic repositoryは静的Preview専用です。

- 昆虫大学の本番run/state/archiveは入っていません
- Experiment Session IDは使いません
- 進化はブラウザ内JavaScriptで実行します
- 現在世代はその端末のIndexedDBに保存します
- Previewのランキングはこの端末内のlocalStorageに保存します（本番の共有ランキングとは別物です）
- 本番実験の世代には影響しません

Privateの開発repositoryがsource of truthです。

## Preview固有の差異

Privateの本番背景は公開していません。

現在のPages版は軽量な仮樹皮背景 `bg_preview.svg` を使用しています。
したがって、Pages版はUI・テンポ・進化体験の確認用であり、
背景そのものの見え方を最終判断する用途には使いません。
