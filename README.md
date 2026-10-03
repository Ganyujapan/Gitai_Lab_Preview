# Gitai_Lab Preview

iPhone / iPadでギタイラボのSOLO進化とゲーム体験を確認するための、公開Preview専用repositoryです。

Fixed Preview URL:

https://ganyujapan.github.io/Gitai_Lab_Preview/

## Preview条件

- SOLO Preview
- 1世代 = 1プレイ
- 1プレイ = 5ラウンド
- 1ラウンド = 12個体
- 1ラウンド = 3.0秒
- ラウンド間 = 250ms
- 60個体を1世代で1回ずつ表示
- 上下HUD安全域・背景禁止領域には個体を配置しない
- 生存個体だけから次世代を生成
- 生存0〜1個体は同じ世代を再試行
- SOLO v2は短時間で見た目の進化を確認するため、Private本番のEXHIBITIONとは異なる進化profileを使用
- 低確率（各子個体0.3%）で、親色から独立した全体色突然変異が発生。色相は0〜360°から選び、最低彩度15%を与えつつ明暗・模様は保持
- 現在世代は端末内IndexedDB、PreviewランキングはlocalStorageに保存
- 「テストをリセット」で端末側のPreview進化・ランキングを初期化

## 公開範囲

このrepositoryにはPreviewを動かすためのファイルだけを置きます。

Private repository `Ganyujapan/Gitai_Lab` がsource of truthです。
昆虫大学 / みんなでギタイ用のEXHIBITION profile、本番state、run archive、server-side evolution設定はここには置きません。

Private本番背景も公開せず、Previewは軽量な仮樹皮背景を使用します。
