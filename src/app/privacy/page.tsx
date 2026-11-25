import { BRAND_OG_IMAGE } from '@/lib/og-metadata';
import siteConfig from '@/lib/site-config';
import { Metadata } from 'next';

const lastUpdated = '2026年2月2日';

export const metadata: Metadata = {
  title: `プライバシーポリシー | ${siteConfig.name.full}`,
  description: `${siteConfig.name.full}のプライバシーポリシーです。`,
  openGraph: {
    title: `プライバシーポリシー | ${siteConfig.name.full}`,
    description: `${siteConfig.name.full}のプライバシーポリシーです。`,
    url: `${siteConfig.url}/privacy`,
    images: [BRAND_OG_IMAGE],
  },
};

export default function PrivacyPolicyPage() {
  return (
    <div className="legal-content">
      <p className="page-eyebrow">POLICY</p>
      <h1 className="mb-6 text-3xl font-bold">プライバシーポリシー</h1>

      {/* プライバシーポリシーの最終更新日を明示 */}
      <p className="mb-4">最終更新日：{lastUpdated}</p>

      <p className="mb-6">
        本プライバシーポリシー（以下「本ポリシー」）は、{siteConfig.name.full}
        （以下「本サービス」）の提供に際し、運営者（以下「当方」）が取り扱う利用者に関する情報（個人情報を含みます）の取扱いを定めるものです。
        本ポリシーにおける「イベント」「回答」「コメント」等の用語は、特段の定めがない限り、利用規約に定める意味と同一の意味を有するものとします。
      </p>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">1. 事業者情報・お問い合わせ窓口</h2>
      <h3 className="mb-2 text-xl font-semibold">1.1 お問い合わせ窓口</h3>
      <p className="mb-4">
        本サービスにおける情報の取扱いに関するご質問、苦情・相談、ならびに後記「9.
        ご本人からの請求（開示等）」のお申出は、以下の窓口で受け付けます。
      </p>
      <ul className="mb-6 list-disc pl-6">
        <li>
          連絡用メールアドレス：
          <a className="text-primary hover:underline" href="mailto:contact@k-tkms.com">
            contact@k-tkms.com
          </a>
        </li>
      </ul>

      <h3 className="mb-2 text-xl font-semibold">
        1.2 事業者情報の通知について（常時掲示しない方針）
      </h3>
      <p className="mb-6">
        当方の氏名/名称・住所（法人の場合は代表者氏名を含む）は、本サービス上で常時掲示しません。ただし、個人情報保護法の趣旨に従い、
        ご本人から求めがあった場合には遅滞なく通知します。
      </p>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">2. 取得する情報</h2>
      <h3 className="mb-2 text-xl font-semibold">2.1 利用者が入力・送信する情報</h3>
      <ul className="mb-6 list-disc pl-6">
        <li>イベント情報（例：イベント名、説明文、候補日程等）</li>
        <li>回答情報（例：可否、コメント等）</li>
        <li>お問い合わせ情報（例：送信者情報、本文等）</li>
        <li>
          ログイン時に取得されるアカウント情報（Googleアカウントの氏名、メールアドレス、プロフィール画像等）
        </li>
        <li>閲覧履歴（ログインユーザーの閲覧・作成履歴、同期情報）</li>
      </ul>
      <p className="mb-6">
        本サービスは、説明文やコメント等に個人を直接特定できる情報（氏名、住所、電話番号、メールアドレス等）を入力しないよう求めます。利用者がこれらを入力した場合、当方が当該情報を取り扱うことになり得るため、必要に応じて削除その他の対応を行う場合があります。
      </p>

      <h3 className="mb-2 text-xl font-semibold">2.2 自動的に取得される情報（アクセスログ等）</h3>
      <ul className="mb-6 list-disc pl-6">
        <li>IPアドレス、User-Agent、閲覧日時</li>
        <li>参照元（リファラ）、閲覧したページURL</li>
        <li>本サービスの維持・保護に必要な範囲の操作ログ</li>
        <li>障害解析・不正対策に必要な範囲のエラー情報</li>
      </ul>

      <h3 className="mb-2 text-xl font-semibold">2.3 Cookie等の識別子・解析に伴い取得される情報</h3>
      <p className="mb-6">
        当方は、後記「6. Cookie等・外部送信（アクセス解析等）」に記載のとおり、Google Tag Manager /
        Google Analytics
        等の利用に伴い、Cookie等の識別子や閲覧情報等を取得・送信する場合があります。
      </p>
      <p className="mb-6">
        ログインを利用する場合、セッション維持のためにCookie等の識別子が利用されます。
      </p>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">3. 利用目的</h2>
      <p className="mb-4">当方は、取得した情報を、以下の目的の範囲で利用します。</p>
      <ol className="mb-6 list-decimal pl-6">
        <li className="mb-2">本サービスの提供（イベント作成・表示・共有・回答の表示等）</li>
        <li className="mb-2">利用者からのお問い合わせ対応</li>
        <li className="mb-2">
          本サービスの維持・保護（不正利用防止、セキュリティ確保、障害対応、ログ分析）
        </li>
        <li className="mb-2">利用状況の分析および品質改善（アクセス解析）</li>
        <li className="mb-2">規約違反行為への対応、紛争対応</li>
        <li className="mb-2">ログイン連携・履歴同期・アカウント管理（連携解除/削除を含む）</li>
      </ol>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">4. 第三者提供</h2>
      <p className="mb-4">当方は、原則として、取得した情報を第三者に提供しません。</p>
      <ul className="mb-6 list-disc pl-6">
        <li>法令に基づく場合</li>
        <li>人の生命・身体・財産の保護のために必要で、ご本人の同意を得ることが困難な場合</li>
        <li>その他、個人情報保護法その他の法令で認められる場合</li>
      </ul>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">5. 委託（クラウド等の利用）</h2>
      <p className="mb-4">
        当方は、本サービス提供のため、以下の事業者のサービスを利用しており、当該事業者が当方に代わって、または当方の指示の範囲で情報を取り扱う場合があります（業務委託）。当方は、委託先の選定、契約、監督等、必要かつ適切な措置を講じます。
      </p>
      <ul className="mb-6 list-disc pl-6">
        <li>Supabase：データベース／ストレージ（※現時点でSupabase Authは不使用）</li>
        <li>Vercel：ホスティング、Edge実行環境、cron、OG生成等</li>
        <li>Cloudflare：CDN／DNS／リバースプロキシ、Email Routing（問い合わせメールの転送運用）</li>
        <li>
          Google：Google OAuth（ログイン連携）、Google Tag Manager／Google
          Analytics（アクセス解析）、Google Calendar（リンク遷移）、（条件により）Google Fonts
        </li>
      </ul>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">6. Cookie等・外部送信（アクセス解析等）</h2>
      <p className="mb-4">
        当方は、本サービスの利便性向上・品質改善等のため、第三者のサービス（タグ/SDK等）を利用し、利用者端末から外部の事業者へ情報が送信される場合があります。送信先・送信される情報・目的等は、以下のとおりです。
      </p>

      <h3 className="mb-2 text-xl font-semibold">6.1 外部送信の一覧（送信先／情報／目的）</h3>
      <h4 className="mb-2 mt-4 text-lg font-semibold">(1) Google OAuth（ログイン連携）</h4>
      <ul className="mb-4 list-disc pl-6">
        <li>送信先：Google</li>
        <li>
          送信される可能性のある情報：OAuth認証に必要な情報（認可リクエスト、端末/ブラウザ情報、IPアドレス等）
        </li>
        <li>目的：ログイン認証</li>
      </ul>

      <h4 className="mb-2 mt-4 text-lg font-semibold">(2) Google tag / Google Analytics 4</h4>
      <ul className="mb-4 list-disc pl-6">
        <li>送信先：Google</li>
        <li>
          送信される可能性のある情報：Cookie等の識別子、サニタイズ済みのページパス・ページタイトル・参照元、端末/ブラウザ情報、作成・回答・共有・確定・ログインの操作種別やステップ、入力方式、選択件数等の集計用パラメータ
        </li>
        <li>
          送信しない情報：イベントURLの公開トークン、参加者ID・名前、イベントのタイトル・説明、回答内容、候補日時・確定日程のID、カレンダー連携URLなど個別の内容
        </li>
        <li>目的：アクセス解析、利用状況把握、品質改善</li>
      </ul>

      <h4 className="mb-2 mt-4 text-lg font-semibold">(3) Vercel（ホスティング/Edge/cron/OG）</h4>
      <ul className="mb-4 list-disc pl-6">
        <li>送信先：Vercel</li>
        <li>
          送信される可能性のある情報：アクセスログ（IP、User-Agent、リクエスト情報等）、Edge実行に必要なヘッダ情報等
        </li>
        <li>目的：配信、性能・安定運用、障害対応・セキュリティ</li>
      </ul>

      <h4 className="mb-2 mt-4 text-lg font-semibold">(4) Supabase（DB/ストレージ）</h4>
      <ul className="mb-4 list-disc pl-6">
        <li>送信先：Supabase</li>
        <li>
          送信される可能性のある情報：イベント/回答等の保存対象データ、アクセスに伴う技術情報（IP等）
        </li>
        <li>目的：データ保存、サービス提供（※現時点でSupabase Authは利用していません）</li>
      </ul>

      <h4 className="mb-2 mt-4 text-lg font-semibold">
        (5) Cloudflare（CDN/DNS/Proxy、Email Routing）
      </h4>
      <ul className="mb-4 list-disc pl-6">
        <li>送信先：Cloudflare</li>
        <li>
          送信される可能性のある情報：アクセスログ、セキュリティ上の検知に必要な情報、（Email
          Routingでは）転送されるメールのヘッダ/本文等
        </li>
        <li>目的：配信最適化、セキュリティ、メール転送</li>
      </ul>

      <h4 className="mb-2 mt-4 text-lg font-semibold">(6) Google Calendar（リンク遷移）</h4>
      <ul className="mb-4 list-disc pl-6">
        <li>
          内容：利用者がリンクを選択した場合、calendar.google.com
          に遷移します。遷移に伴い参照元情報等が送信される場合があります。
        </li>
        <li>目的：利用者のカレンダー登録等の利便性提供</li>
      </ul>

      <h4 className="mb-2 mt-4 text-lg font-semibold">(7) Google Fonts（条件付き）</h4>
      <ul className="mb-4 list-disc pl-6">
        <li>送信先：fonts.googleapis.com / fonts.gstatic.com</li>
        <li>
          備考：本サービスがフォントを読み込む実装になっている場合に限り通信が発生します（構成により発生しない場合があります）。
        </li>
      </ul>

      <h3 className="mb-2 text-xl font-semibold">6.2 オプトアウト（解析の無効化）</h3>
      <p className="mb-6">
        利用者は、ブラウザ設定によりCookieを無効化することができます。また、Google
        Analyticsについては、Googleが提供するオプトアウト手段（ブラウザアドオン等）により、Google
        Analyticsへの送信を無効化できる場合があります。
      </p>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">7. 国外移転（越境移転）について</h2>
      <p className="mb-6">
        当方が利用するクラウド/解析/CDN等の事業者は、国外に所在する拠点・サーバ等で情報を取り扱う場合があります。個人データを外国にある第三者へ提供する場合には、個人情報保護法および個人情報保護委員会のガイドラインに従い、必要な措置（同意取得や情報提供等）を行います。
      </p>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">8. 安全管理措置</h2>
      <p className="mb-4">
        当方は、取り扱う情報の漏えい、滅失又は毀損等を防止するため、必要かつ適切な安全管理措置を講じます。具体的には、次のような措置を、リスクに応じて実施します。
      </p>
      <ul className="mb-6 list-disc pl-6">
        <li>アクセス制御、権限管理</li>
        <li>通信の暗号化等</li>
        <li>ログの監視、障害・不正の検知</li>
        <li>委託先の選定・契約・監督</li>
        <li>インシデント対応体制の整備</li>
      </ul>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">
        9. ご本人からの請求（開示・訂正・利用停止等）
      </h2>
      <p className="mb-4">
        当方が保有するご本人に関する情報（保有個人データ）について、ご本人は、利用目的の通知、開示、訂正・追加・削除、利用停止、第三者提供停止等を求めることができます。
        これらの手続に関する事項は、本人の知り得る状態（求めに応じて遅滞なく回答する運用を含む）に置く必要があるとされています。
      </p>
      <ul className="mb-6 list-disc pl-6">
        <li>申出窓口：上記「1. 事業者情報・お問い合わせ窓口」</li>
        <li>
          本人確認：アカウントは任意です。ログイン済みの方はアカウント情報により確認できる場合があります。未ログインの方は、対象データの特定に必要な情報（該当ページURL、作成日時、表示される識別情報、問い合わせ時の送信情報等）の提示をお願いする場合があります。確認は必要最小限の範囲で行います。
        </li>
        <li>回答方法：メールその他当方が適切と判断する方法</li>
        <li>手数料：原則無料（合理的範囲で実費をご負担いただく場合は事前に通知します）</li>
      </ul>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">10. 保存期間・削除</h2>
      <p className="mb-4">
        当方は、取得した情報を利用目的の達成に必要な期間に限り保持し、利用する必要がなくなった個人データについては、遅滞なく消去するよう努めます。現時点では、情報の種類ごとの保存期間（○日/○か月等）を固定していませんが、必要以上に長期の保管とならないよう、業務上の必要性、保管による影響等を勘案して運用します。
      </p>
      <h3 className="mb-2 text-xl font-semibold">10.1 保存期間の考え方（カテゴリ別）</h3>
      <ul className="mb-4 list-disc pl-6">
        <li>サービス提供上の必要性（イベント表示・回答の提供等）</li>
        <li>不正対策・セキュリティ確保・障害対応の必要性（ログ等）</li>
        <li>お問い合わせ対応・紛争対応の必要性</li>
        <li>保管期間の長期化によるリスク</li>
      </ul>
      <p className="mb-4">
        保存期間を具体化した場合は、本ポリシーまたは本サービス上の掲示により周知します。
      </p>

      <h3 className="mb-2 text-xl font-semibold">10.2 利用者からの削除要請</h3>
      <p className="mb-4">
        利用者から、イベント情報や回答情報等の削除要請があった場合、当方は合理的な範囲で対応します。対象の特定や本人確認のため、必要な情報の提示をお願いする場合があります。
      </p>
      <p className="mb-4">
        ログイン連携情報の削除（アカウント削除）は、アカウントページから本人操作で行うことができます。
      </p>

      <h3 className="mb-2 text-xl font-semibold">10.3 バックアップ・ログへの残存</h3>
      <p className="mb-4">
        当方は、障害復旧・セキュリティ確保等の目的でバックアップやログを保持する場合があります。削除要請を受けた場合でも、バックアップやログに一定期間残存することがありますが、当方の管理のもとで保護し、運用上合理的な期間の経過後に順次消去します。
      </p>

      <h3 className="mb-2 text-xl font-semibold">10.4 匿名化・統計化</h3>
      <p className="mb-6">
        当方は、品質改善等の目的で、個人が識別されない形（統計情報等）に加工したうえで継続利用する場合があります。
      </p>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">11. 未成年の利用</h2>
      <p className="mb-6">
        未成年の方が本サービスを利用する場合、必要に応じて保護者の同意のもとで利用してください。
      </p>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">12. 本ポリシーの変更</h2>
      <p className="mb-6">
        当方は、法令・ガイドラインの変更、サービス内容の変更等に応じて、本ポリシーを改定することがあります。
      </p>
    </div>
  );
}
