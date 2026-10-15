# AGENTS.md

本書は、DaySynthで作業するエージェントが毎回守る判断基準を定める。詳細な仕様と設計理由は`specifications/`と`docs/`を正本とし、本書へ重複して記載しない。

## 基本原則

- ユーザーの依頼、既存実装、関連仕様、テストを確認してから変更する。
- 依頼を満たす最小限の変更を優先し、明示されていない機能追加、抽象化、リファクタリングを同時に行わない。
- 新しい依存関係、コンポーネント、デザインパターンは、既存手段で解決できない場合だけ追加する。
- 推測で既存仕様を置き換えない。コード、テスト、`specifications/`、`docs/`から確認できることは実物を確認する。
- 不要コード、デッドコード、作業中だけ必要だったコメントを残さない。
- コメント、JSDoc、コミットメッセージは日本語で記述する。
- ユーザーから直接指示がない限り、ブランチ作成、コミット、push、PR作成などのGit操作を行わない。

## 参照先とドキュメント

- 機能仕様は`specifications/`、設計判断は`docs/architecture/`、変更履歴は`docs/CHANGELOG.md`を参照する。
- 仕様、ユーザー体験、アーキテクチャ、データモデル、セキュリティ、運用方法に意味のある変更がある場合は関連文書を更新する。
- 機能追加、破壊的変更、利用者に見える重要な変更は`docs/CHANGELOG.md`へ追記する。
- セットアップ、必要環境、開発コマンド、導入手順を変更した場合は`README.md`を更新する。
- 既存仕様内の軽微なUI調整、内部リファクタリング、小規模なバグ修正だけを理由に、新しいarchitecture文書を作らない。
- 公開API、複雑な業務ルール、型だけでは意図が分からない処理には日本語JSDocを付ける。TypeScriptの型を説明文で重複させない。

## UI / UX

UI変更時は`docs/architecture/ai-driven-design-guidelines.md`をデザイン判断の正本として参照する。DaySynthではmobile-first / task-firstを優先し、装飾より理解しやすさ、操作の速さ、誤操作の少なさを重視する。

- 現在のデザイン原則と一致する既存パターン、トークン、コンポーネントを優先する。
- 視覚的階層は、まず余白、文字、配置、情報密度で表現する。
- Card、surface、border、divider、background、shadow、Badge、icon、eyebrow、helper textを、見栄えや統一感だけを理由に追加しない。
- UI要素は「情報」「操作」「状態」「階層」のどれを伝えるか説明できる場合に使用する。
- 同じ内容をeyebrow、heading、description、Card title、helper textで繰り返さない。
- 通常のsectionを機械的にCardやsurfaceで囲わない。境界に意味がなければ余白でグルーピングする。
- Cardの入れ子、意味のない装飾線、過剰な角丸や影を避ける。
- 色は主要操作、選択、状態など定義済みの意味に沿って使う。
- 装飾目的のgradient、glow、blur、shadow、motionを追加しない。motionは状態変化や操作結果の理解を助ける場合に限定し、`prefers-reduced-motion`を尊重する。
- 既存実装がデザインガイドと矛盾する場合、そのパターンを新規実装へ広げない。
- UI変更後は、機能と情報を失わずに削除できる説明文、Card、border、Badge、icon、eyebrowがないか確認する。

## TypeScript / React

- TypeScriptの`strict`を維持し、未使用変数と安易な`any`を残さない。外部入力は型ガードまたはスキーマで検証する。
- Server Componentsを優先し、ブラウザAPI、イベント処理、クライアント状態が必要な範囲だけClient Componentへ分離する。
- Supabase CLIで生成した型と`@supabase/supabase-js`が提供する型を優先し、不足分だけ用途の明確な型を追加する。
- Server Actionsを優先し、Route Handlersは外部連携、HTTP公開境界、ストリーミングなど必要性がある場合に使用する。
- Route Handlerを追加する場合は、HTTPメソッド、ステータスコード、エラー形式を既存APIと揃える。

## Supabase / セキュリティ

- クライアントからSupabaseへ直接アクセスしない。DB操作はサーバー側のServer Actions、Route Handlers、RPCなどを経由する。
- 認証と認可はサーバー境界で確認し、クライアントから渡された識別子や権限を信用しない。
- RLSを有効にし、スキーマ変更はマイグレーションファイルで管理する。管理画面での手作業変更を前提にしない。
- 公開・更新系の境界では、用途に応じて入力検証、rate limit、CSRF、CORS、再試行、冪等性を設計する。
- ユーザー向けエラーと開発者向け詳細を分離し、ログへPII、トークン、秘密情報を出力しない。
- 秘密情報はGit管理対象外の`.env*`またはデプロイ先のSecret Managerで管理し、コード、ログ、ドキュメントへ記載しない。

## 検証

変更内容とリスクに比例した検証を行う。挙動変更、バグ修正、境界条件には回帰テストを追加する。実装の文字列やクラス名をそのまま確認するだけで、利用者の振る舞いを保証しないテストは増やさない。

- 基本確認: `npm run lint`、`npm run typecheck`、変更箇所に関連するテスト
- ドキュメントのみの変更: `git diff --check`と対象Markdownのフォーマット確認
- 影響範囲が広い変更: `npm run test:ci`、`npm run build`
- UI変更: 関連するunit testと、必要に応じてPlaywrightによる実画面確認
- 主要フロー、認証、複数画面へ影響する変更: `npm run test:e2e:chrome`
- E2Eの要素取得は、表示文言やclass名より`data-testid`または`data-e2e`を優先する。
- 失敗した検証は、原因を調査して修正する。今回の変更と無関係な失敗は、再現条件と判断根拠を報告する。
- 検証を実行できない場合は、未実施項目と理由を報告する。

## Git / GitHub

- GitHub Flowを使用し、`main`から短命ブランチを作り、`main`向けPRで統合する。
- ブランチ名に`codex/`プレフィックスを付けず、変更内容に応じた簡潔な名前を使用する。
- コミットメッセージは日本語 + Conventional Commitsとする（例: `feat: 回答履歴を追加`）。
- 大きな変更は設計判断を`docs/architecture/`へ整理し、必要に応じてDraft PRで共有する。
- PRではテンプレートの目的、変更点、動作確認、影響範囲、スクリーンショット、関連Issueを埋める。
- GitHubへ日本語本文を送る処理はWSL内でUTF-8のまま完結させる。Windows PowerShellのhere-stringやパイプを`gh --body-file -`へ渡さない。
- Windows側から送信する必要がある場合は本文をUTF-8でBase64化し、WSL内で復号したJSONを`gh api --input -`へ渡す。送信後はAPIで再取得し、先頭BOMと`???`がないことを確認する。
