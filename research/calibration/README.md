# GITAI SCORE — 人間評価データ（2026-10-14）

Gitai_Lab_Preview の採点検証用データです。進化ロジックには使いません。

## データ

- [calibration_dataset_index_2026-10-14.json](./calibration_dataset_index_2026-10-14.json) : **全624件**の目録。樹皮001 **307件**、砂地001 **317件**。全件を ID で検証し、重複はありません。
- `raw/bark_source_256_2026-10-14.json` : 最初の256件
- `raw/sand_source_317_part1.json` : 2回目の砂地159件
- `raw/sand_source_317_part2.json` : 2回目の砂地158件
- `raw/bark_source_additional_51.json` : 2回目の樹皮51件
- [high_rating_seed_genomes_v1.json](./high_rating_seed_genomes_v1.json) : 上位人間評価をもとに選んだ**42個体**のGenome。高擬態評価モードの候補生成専用。

どの `raw/*.json` もそれぞれ有効なJSONです。GitHub APIの転送制限により4ファイルに分けて保管しています。
`reconstruct_combined.py` で完全な統合JSONを再作成できます（Python標準ライブラリのみ）。

```sh
python3 research/calibration/reconstruct_combined.py
```

## 分析・評価の取り扱い

1. 人間評価は「完成域／ほぼ完成／非常に優秀／優秀／良好／よく目立つ」の**順序尺度**。0～100点への恣意的な換算は禁止。
2. GITAI SCORE v1の点数と、人間評価は別の指標です。採点時は機械スコアも種親の過去評価も非表示。
3. `sampling.mode=balanced` は旧ランダム評価、`sampling.mode=high` は高評価のGenomeを変異させた候補から上位を選ぶ評価。後者は**無作為抽出ではありません**。
4. データ上の外れ値は原本から削除せず、除外理由を別ファイルで記録して解析時のみ除外してください。
5. 同一背景に複数の背景画像記録があり、背景IDと位置を組み合わせて再現します。

**注意：この研究フォルダは公開GitHubリポジトリに保存されています。** 将来、他の協力者の評価やカスタム背景を保存する場合には公開・著作権・プライバシーの扱いを確認してください。

## 高擬態評価モード 第1回（2026-10-14）

- [high_focus/manifest_2026-10-14.json](./high_focus/manifest_2026-10-14.json)：新規338件。樹皮162件、砂地176件。最初の624件と重複なし。
- high_focus/raw/high_focus_20261014_part1.json 〜 part5.json：新しい人間評価338件の原本（5分割）。背景画像は旧データと一致するため参照のみ。
- [high_focus/reconstruct_962.py](./high_focus/reconstruct_962.py)：旧624件＋新規338件＝合計962件を再構築（樹皮469件・砂地493件）。

復元コマンド： python3 research/calibration/high_focus/reconstruct_962.py

高擬態モードは、過去に人間が高評価した個体のGenomeを変異させ、さらにv1の高得点候補を選んで提示します。**無作為標本ではなく、種親の系列と相関があります。** そのため生成個体の評価割合を自然な擬態成功率とは解釈しません。

新規338件の内訳は、完成域1件・ほぼ完成63件・非常に優秀245件・優秀29件です。初の完成域は樹皮001、個体ID rating-mv838ot6-iqikz2b09（v1局所90.5955）でした。

**種親ライブラリ42件は更新せず固定**しています。新しい人間評価を種親選抜へ即座に反映させると、採点器の評価にデータ漏洩が生じるためです。

従来の624件のマニフェストと復元ツールは改変せず、ランダム評価と高擬態評価を別々に保管します。
