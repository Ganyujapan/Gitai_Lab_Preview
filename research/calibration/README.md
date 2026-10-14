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
