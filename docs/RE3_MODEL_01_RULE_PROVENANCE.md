# RE3-MODEL-01 — 世代ごとの進化ルール由来（2026-10-28）

## 目的と運用

同じ `run`・`model_id`・`config_id` のまま進化コードが変化したとき、
**それぞれの確定済み世代の計算に使われたプレビュー配信ビルド**を後から識別する。
過去の進化履歴・PNG・DNAを読み替えない。ゲームの選択・繁殖・突然変異・描画処理には影響させない。

- `rule_provenance` は新しく確定した各世代の `diagnostic:<source_generation>` に記録される。
  子の `<next_generation>` を生成したルールという意味。
- `status: recorded`, `schema_version: 1`
- `rule_revision`：モデルごとに管理する人間可読なルール改訂ID。
  進化ルールの意味・アルゴリズムを変更するPRでは**必ず改訂する**。
- `build_commit`：GitHub Pagesがビルドした当該ゲームJSのGitコミットSHA（40桁）。
  デプロイ時に `exhibit/build.py` がプレビュー版・展示版の双方に埋め込む。
  `config_id` に変更がなくても、異なるコード版を区別できる。
  ローカルの未ビルド版では `null` とし、存在しないコミットを捏造しない。
- `model_id`、`config_id`、`engine_version`：使用したモデルと設定の識別子。
- `mutation_profile` と `mutation_probability_factor`：
  通常プレイ（`normal`、1）か、展示プレイ（`exhibit_probability_scaled`、0.5）かを区別。
  `run_id` は診断記録の従来フィールドであり、毒／無毒や霧の既存分岐を判別できる。

`diagnostic` は元世代Gの捕食・繁殖から次世代G+1を作った結果であるため、
ルール版も **G→G+1** に付属する。ユーザーによる捕食前に生成する最初の創始世代や
目立つギタイの初期20世代の無捕食準備に、存在しなかった診断を偽造しない。

## 整合性

`js/pages_preview.js` の既存 `commitEvolutionGeneration()` は、
DNA60個・PNG60枚・`diagnostic:<G>`・世代ポインタを
同一IndexedDB readwriteトランザクション内で確定する。
由来情報は診断オブジェクトの追加フィールドに過ぎず、別ストアへの保存も
DB schema/versionの変更も不要。トランザクションが中断される場合は診断も一括でロールバックされる。

旧世代に `rule_provenance` がなければ、JSON診断エクスポート上で
`status: legacy_unknown` を **読み取り専用で** 表示する。
古いログへ現在のモデル・ビルド・ルール版を補填することは禁止する。
テキストログは従来の `GITAI_LAB_CHATGPT_LOG_V1` 形式を維持し、
各世代に `rules=... profile=... factor=... build=...` または
`rules=legacy_unknown` の行を追加する。

展示版v1の管理者バックアップは既存の `meta` 内容をそのまま含むため
記録済み診断も往復する。復元時に既存診断へ新フィールドを要求せず、
従来の旧JSONの互換性を保つ。

## ルール変更の際のレビュー

1. `EVOLUTION_RULE_REVISIONS` の対象モデル改訂IDを変更する。
2. `config_id` と `engine_version` の変更要否を別に判断する（既存IDを不用意に変えない）。
3. 展示版の確率スケーリングと初期20世代（通常率）の関係を確認する。
4. `verify-re3-model01-rule-provenance.cjs` の期待値を新しい改訂IDに合わせて更新する。
5. PR CIとPagesのデプロイ成功を確認する。旧保存データの再書き込みやリセットは禁止。

## 検証の限界

- `build_commit` は配信されたコードの起点を表す。保存前にブラウザが外部リソースを不整合に
  混在させた場合まで、アルゴリズムの全入力を暗号学的に証明する値ではない。
- 初代・警告色の中立準備20世代など、従来診断が存在しない履歴は別途記録設計が必要。
- 古い診断の真正な進化ルール版は、過去のデータだけから復元できない。
- iPad Safari実機、実機でのオフライン更新・復元テストは未実施である。
