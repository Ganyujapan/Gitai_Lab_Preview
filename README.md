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
- SOLO v10は短時間で見た目の進化を確認するため、Private本番のEXHIBITIONとは異なる進化profileを使用
- 低確率（各子個体0.3%）で、親色から独立した全体色突然変異が発生。色相は0〜360°から選び、最低彩度15%を与えつつ明暗・模様は保持\n- 低確率（各子個体0.6%）で、全体明度突然変異が発生。平均明度の目標を0.35〜0.90から選び、既存の模様・色相・彩度を保ちながら個体全体の明るさを移動
- SOLO v10では明度進化だけを速めるため、通常のV変化幅・全体value shift幅・全体明度突然変異を調整。色相・彩度など明度以外の基本変異率はSOLO v2基準を維持
- SOLO v10では模様パターン関連の値を、模様速度を調整する前の基準値へ戻した。明度進化だけは速めた設定を維持
- 現在世代は端末内IndexedDB、PreviewランキングはlocalStorageに保存
- 「テストをリセット」で端末側のPreview進化・ランキングを初期化

## 公開範囲

このrepositoryにはPreviewを動かすためのファイルだけを置きます。

Private repository `Ganyujapan/Gitai_Lab` がsource of truthです。
昆虫大学 / みんなでギタイ用のEXHIBITION profile、本番state、run archive、server-side evolution設定はここには置きません。

Private本番背景も公開せず、Previewは軽量な仮樹皮背景を使用します。

- SOLO v10では模様パターンの新規出現頻度だけを半減し、パッチ発生率を16%に調整。サイズ・強さ・明度・色相など他の設定は維持。

- SOLO v10では全体明度の進化だけを加速。全体明度突然変異率を0.6%→1.2%、目標平均明度範囲を0.25〜0.92に拡大。小さな全体明度変異も出現比率35%・倍率幅±24%に強化し、模様パッチ出現率16%など模様側の設定は維持。
