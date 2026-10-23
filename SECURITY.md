# Security Policy

DaySynth の安全性を守るため、脆弱性や秘密情報の取り扱いには注意してください。

## 対象

- Supabase 関連の設定や権限
- NextAuth と認証フロー
- RLS やサーバーサイドのデータアクセス
- 外部連携 API と環境変数

## 報告方法

Please do not report security vulnerabilities through public GitHub issues.

If GitHub Private Vulnerability Reporting is enabled for this repository, please use it.

If it is not available, please contact the maintainer via the GitHub profile @ktkms.

## 報告に含めてほしい情報

- 問題の概要
- 影響範囲
- 再現手順
- 期待される挙動
- 影響を受ける URL や機能名

## 対応方針

- 秘密情報はローテーションまたは失効を優先します。
- 修正後は関連テストと設定確認を行います。
- 必要に応じてドキュメントも更新します。

## 自動検査と依存関係の更新

- CodeQL は標準クエリで JavaScript／TypeScript と GitHub Actions を解析します。
- Secret scanning と Push protection を有効にし、対応する秘密情報の検出と push 時のブロックを行います。
- Dependency review は main 向け PR で追加・更新された依存関係を検査し、本番・開発・分類不明の依存に High／Critical の既知の脆弱性がある場合は失敗します。ライセンスによる制限は行いません。
- Dependabot alerts と security updates を有効にします。通常のバージョン更新は npm と GitHub Actions を対象に、毎週月曜の日本時間 9 時に確認します。
- minor／patch 更新はグループ化し、major 更新は個別の PR とします。通常更新の同時オープン数は npm が 3 件、GitHub Actions が 2 件までです。security updates はこの上限の対象外です。
- Actions は標準ランナーを使用し、独自の成果物アップロードは追加しません。アプリの CI は Node.js 22 で実行し、同じ PR の古い実行をキャンセルします。
