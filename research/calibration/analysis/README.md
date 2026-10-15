# GITAI SCORE v1 — 統計診断

人間の6段階評価と機械GITAI SCORE v1を、**背景・データ収集方法ごと**に比較する研究用コード。
データ源は research/calibration/ の4つの凍結マニフェストに掲載された合計1103件。
原本は一切編集せず、ゲームや進化・採点UIの既存コードにも影響しない。

## 実行

    python3 research/calibration/analysis/analyze_v1.py --output-dir /tmp/gitai_score_audit

2ファイル生成：

- v1_diagnostic_20261015.md — 条件別集計、人間評価の逆転例、研究上の仮説。
- v1_diagnostic_20261015.json — 成分別の要約と各逆転例の個体ID、評価位置、背景IDなど。

GitHub Actionsの「GITAI SCORE v1 diagnostic」でも実行。結果はWorkflowログとartifactに保存。

**解釈上の注意：** v1による候補最適化を含むため、v1の精度を独立検証した値ではない。
完成域など6段階は順序尺度であり0〜100点に換算しない。最新スコアが高い＝必ず人間の完成域とは限らない。
