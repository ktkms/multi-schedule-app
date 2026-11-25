import { BRAND_OG_IMAGE } from '@/lib/og-metadata';
import siteConfig from '@/lib/site-config';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: `利用規約 | ${siteConfig.name.full}`,
  description: `${siteConfig.name.full}の利用規約です。本サービスを利用する前に必ずお読みください。`,
  openGraph: {
    title: `利用規約 | ${siteConfig.name.full}`,
    description: `${siteConfig.name.full}の利用規約です。本サービスを利用する前に必ずお読みください。`,
    url: `${siteConfig.url}/terms`,
    images: [BRAND_OG_IMAGE],
  },
};

export default function TermsPage() {
  return (
    <div className="legal-content">
      <p className="page-eyebrow">TERMS</p>
      <h1 className="mb-6 text-3xl font-bold">利用規約</h1>

      {/* 利用規約の最終更新日を明示 */}
      <p className="mb-4">最終更新日：2026年2月2日</p>

      <p className="mb-6">
        この利用規約（以下「本規約」といいます。）は、当サービスの運営者（以下「運営者」といいます。）が提供するウェブサービス（以下「本サービス」といいます。）の利用条件を定めるものです。本サービスをご利用になる前に、本規約を必ずお読みいただき、内容に同意のうえご利用ください。
      </p>
      <h2 className="mb-4 mt-8 text-2xl font-semibold">改定履歴</h2>
      {/* 規約の更新履歴を時系列で掲載 */}
      <ul className="mb-6 list-disc pl-6">
        <li className="mb-2">2026年2月2日：ログイン（任意）とアカウント削除に関する記載を追記。</li>
        <li className="mb-2">
          2026年1月19日：最終更新日・改定履歴・お問い合わせ窓口の記載を更新。
        </li>
        <li className="mb-2">2025年4月29日：初版を制定。</li>
      </ul>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">第1条（定義）</h2>
      <ol className="mb-6 list-decimal pl-6">
        <li className="mb-2">
          「本サイト」とは、運営者が本サービスを提供するウェブサイトをいいます。
        </li>
        <li className="mb-2">
          「ユーザー」とは、本規約に同意のうえ本サービスを利用するすべての方をいいます。
        </li>
        <li className="mb-2">
          「登録データ」とは、ユーザーが本サービスに入力・登録したスケジュール、コメントその他一切のデータをいいます。
        </li>
        <li className="mb-2">
          「コンテンツ」とは、本サイト上で提供されるテキスト、画像、映像、プログラム等一切の情報をいいます。
        </li>
        <li className="mb-2">
          「アカウント」とは、Googleアカウント連携により任意で利用できるログイン機能および関連情報をいいます。
        </li>
      </ol>

      <p className="mb-6">
        本サービスはログイン不要で利用できますが、必要に応じてGoogleログインにより履歴同期等の付加機能を利用できます。
        アカウント削除（連携解除）はアカウントページから本人の操作で行うものとします。
      </p>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">第2条（適用）</h2>
      <ol className="mb-6 list-decimal pl-6">
        <li className="mb-2">
          本規約は、本サービスの提供条件および運営者とユーザーとの間の権利義務関係を定めるものです。
        </li>
        <li className="mb-2">
          運営者が本サイト上で掲載する個別規定は、本規約の一部を構成するものとします。
        </li>
        <li className="mb-2">本規約の内容と個別規定が異なる場合は、個別規定が優先されます。</li>
      </ol>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">第3条（個人情報の非掲載）</h2>
      <ol className="mb-6 list-decimal pl-6">
        <li className="mb-2">
          本サービスではセキュリティ確保の観点から、ユーザーが氏名・住所・電話番号・メールアドレスその他個人を特定できる情報を入力・公開することを禁止します。
        </li>
        <li className="mb-2">
          ユーザーは前項に違反して個人情報を掲載したことにより生じた損害について、運営者が一切の責任を負わないことに同意します。
        </li>
      </ol>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">第4条（禁止事項）</h2>
      <p className="mb-4">ユーザーは、以下の行為を行ってはなりません。</p>
      <ul className="mb-6 list-disc pl-6">
        <li className="mb-2">法令または公序良俗に反する行為</li>
        <li className="mb-2">他者の権利・利益を侵害する行為</li>
        <li className="mb-2">不正アクセス、スパム、システムへの過度な負荷を与える行為</li>
        <li className="mb-2">本サービスの運営を妨害する行為</li>
        <li className="mb-2">その他運営者が不適切と判断する行為</li>
      </ul>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">第5条（広告・アフィリエイト）</h2>
      <ol className="mb-6 list-decimal pl-6">
        <li className="mb-2">
          本サイトには第三者広告およびアフィリエイトリンクが掲載される場合があります。
        </li>
        <li className="mb-2">
          広告主との取引・連絡等はユーザーと広告主の責任で行うものとし、運営者は一切責任を負いません。
        </li>
      </ol>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">第6条（アクセス解析）</h2>
      <ol className="mb-6 list-decimal pl-6">
        <li className="mb-2">本サービスは利用状況把握のため Google Analytics を使用します。</li>
        <li className="mb-2">
          Google Analytics
          はクッキーを利用してアクセス情報を収集しますが、個人を特定する情報は含まれません。
        </li>
        <li className="mb-2">
          ユーザーは本サービスを利用することで、Google
          が定めるポリシーに基づきデータが収集・処理されることに同意するものとします。
        </li>
      </ol>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">第7条（知的財産権）</h2>
      <ol className="mb-6 list-decimal pl-6">
        <li className="mb-2">
          本サービスおよび本サイトに含まれるコンテンツの著作権その他の知的財産権は運営者または正当な権利を有する第三者に帰属します。
        </li>
        <li className="mb-2">
          ユーザーは運営者の事前の許可なく、コンテンツを複製・転載・改変・配布してはなりません。
        </li>
      </ol>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">第8条（免責事項）</h2>
      <ol className="mb-6 list-decimal pl-6">
        <li className="mb-2">
          運営者は、本サービスの内容およびユーザーが登録したデータの正確性・有用性を保証しません。
        </li>
        <li className="mb-2">
          本サービスの利用または利用不能に起因して生じた損害について、運営者は一切責任を負いません。
        </li>
        <li className="mb-2">
          本サービスに関連してユーザー間またはユーザーと第三者との間で生じた紛争について、運営者は一切責任を負いません。
        </li>
      </ol>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">第9条（サービス提供の中断・終了）</h2>
      <ol className="mb-6 list-decimal pl-6">
        <li className="mb-2">
          運営者は、システム保守・障害対応・天災地変その他やむを得ない事由により、本サービスの全部または一部を予告なく中断・終了することがあります。
        </li>
        <li className="mb-2">
          運営者は、前項によりユーザーに生じた損害について一切責任を負わないものとします。
        </li>
      </ol>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">第10条（データ消失）</h2>
      <ol className="mb-6 list-decimal pl-6">
        <li className="mb-2">
          登録データはバックアップ保証の対象外とします。ユーザーは自己の責任において必要なバックアップを行うものとします。
        </li>
        <li className="mb-2">
          データ消失によりユーザーに生じた損害について、運営者は一切責任を負いません。
        </li>
      </ol>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">第11条（反社会的勢力の排除）</h2>
      <ol className="mb-6 list-decimal pl-6">
        <li className="mb-2">
          ユーザーは、自らが暴力団等の反社会的勢力に該当しないことを表明・保証します。
        </li>
        <li className="mb-2">
          運営者は、ユーザーが反社会的勢力に該当すると判断した場合、事前通知なく利用停止・登録削除等の措置を講じることができます。
        </li>
      </ol>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">第12条（年齢制限）</h2>
      <ol className="mb-6 list-decimal pl-6">
        <li className="mb-2">本サービスの利用対象年齢は18歳以上とします。</li>
        <li className="mb-2">
          未成年者が本サービスを利用する場合は、保護者の同意を得たうえで利用するものとします。
        </li>
      </ol>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">第13条（規約の改定）</h2>
      <ol className="mb-6 list-decimal pl-6">
        <li className="mb-2">
          運営者は必要に応じて本規約を改定できます。改定後の規約は本サイトに掲載した時点で効力を生じます。
        </li>
        <li className="mb-2">
          ユーザーが改定後に本サービスを利用した場合、当該ユーザーは改定後の規約に同意したものとみなします。
        </li>
      </ol>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">第14条（準拠法・裁判管轄）</h2>
      <p className="mb-6">
        本規約の準拠法は日本法とし、本サービスに関して紛争が生じた場合、運営者所在地を管轄する地方裁判所を第一審の専属的合意管轄裁判所とします。
      </p>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">第15条（完全合意・分離可能性）</h2>
      <ol className="mb-6 list-decimal pl-6">
        <li className="mb-2">
          本規約は、本サービスに関する運営者とユーザーとの完全な合意を構成します。
        </li>
        <li className="mb-2">
          本規約の一部が無効となった場合でも、他の条項は継続して有効に存続するものとします。
        </li>
      </ol>

      <h2 className="mb-4 mt-8 text-2xl font-semibold">第16条（お問い合わせ窓口）</h2>
      <p className="mb-6">
        {/* 安全性を担保するため、連絡先と注意事項を明記 */}
        本サービスに関するお問い合わせは、下記メールアドレスにて受け付けます。
        <br />
        お問い合わせ先：
        <a className="text-primary hover:underline" href="mailto:contact@k-tkms.com">
          contact@k-tkms.com
        </a>
        <br />
        なお、内容により回答できない場合があります。また、回答までにお時間をいただく場合があります。
        <br />
        ユーザーは、お問い合わせの際に必要以上の個人情報（氏名、住所、電話番号、メールアドレス等）を本文に記載しないようご注意ください。
      </p>
    </div>
  );
}
