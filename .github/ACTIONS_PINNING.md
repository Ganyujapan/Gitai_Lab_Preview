# CI-02: GitHub Actionsのコミット固定（2026-10-28）

GitHub公式の `refs/tags/v4` / `refs/tags/v5` を、GitHub REST
`/repos/<owner>/<repo>/git/ref/tags/<tag>` から確認し、commit SHAに固定しました。

| Action | 元の参照 | 固定した commit SHA |
| --- | --- | --- |
| actions/checkout | v4 | `11d5960a326750d5838078e36cf38b85af677262` |
| actions/configure-pages | v5 | `983d7736d9b0ae728b81ab479565c72886d7745b` |
| actions/upload-pages-artifact | v4 | `7b1f4a764d45c48632c6b24a0339c27f5614fb0b` |
| actions/deploy-pages | v4 | `d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e` |

公式の取得先：
- https://api.github.com/repos/actions/checkout/git/ref/tags/v4
- https://api.github.com/repos/actions/configure-pages/git/ref/tags/v5
- https://api.github.com/repos/actions/upload-pages-artifact/git/ref/tags/v4
- https://api.github.com/repos/actions/deploy-pages/git/ref/tags/v4

## 更新手順

1. 定期的に公式リポジトリのタグとリリースノートを点検する。タグ先は変わり得る。
2. 変更後の完全な40桁 commit SHA と差分/互換性を確認し、2つのworkflowと `.github/scripts/verify-ci02-action-pins.cjs` の期待値を**同じPR**で更新する。
3. PR上で共通verify、Pages artifact内容、exhibitオフラインの検証を成功させる。
4. `main` にマージ後、Pagesの実際のデプロイが成功したことを確認する。

固定は更新不要を意味しない。現状は検証jobが `contents:read` に分離されているが、`deploy` job内でbuild/upload/deployとPages書込権限が共存するため、**CI-02全体としては未完了**。ジョブの分離は独立したPRとデプロイ再検証が必要です。
