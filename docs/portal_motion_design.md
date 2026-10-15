# ギタイラボ — トップページ・モーション試作（2026-10-15）

エンタメ版の入口だけの改修。ゲーム本体・進化ロジック・保存データ・教育版・採点機能・メニューは変更しない。

## デザイン

夜の森の小さな生命を、エディトリアルなタイポグラフィと、独立した植物・蛾のイラストの緩やかな動きで表現。参考は複数素材を異なる速度で動かす仕組みであり、他社の画像やロゴは使用していない。現状のSVGはすべて交換用の仮素材。

## 素材の変更場所

- img/portal/moth.svg : 中心の蛾
- img/portal/branch.svg : 枝
- img/portal/fern.svg : シダ
- img/portal/leaf.svg : 葉っぱ
- img/portal/seed.svg : 小さな植物
- img/portal/halo.svg : 背景の円

それぞれ独立した透明SVG。**同じファイル名で差し替えれば、アニメーションは維持される。** PNGにする場合は、js/portal_scene.js の asset を変更する。

js/portal_scene.js : 位置 x/y（画面%）、画像幅 w（画面幅%）、上限 max（px）、奥行き depth、アニメーション周期 drift（秒）、開始位相 phase、重なり z。

css/portal_motion.css : デザインと独立アニメーション。
js/portal_motion.js : SVG配置・ポインタ追従・タップ波紋・省電力処理。
既存の js/entertainment_portal.js : 入口の旧Canvas線画描画だけ停止し、メニューCanvasは維持。

## 検証ポイント

iPhone Safari / iPad Safari / PC のサイズ、START→メニュー、メニュー→タイトル、SOLO→ゲーム、次世代への移行（play=1）、教育版への直行、アクセシビリティ設定の動きを減らす。最終のアニメーション質感は提供される参考画面収録を見て二次調整する。
