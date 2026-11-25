import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import siteConfig from '../../../lib/site-config';

import { LayerMark, OG_IMAGE_SIZE, palette, Shell } from '../../_og/design';
import { HOME_OG_IMAGE } from '@/lib/og-metadata';

export const runtime = 'edge';

/**
 * OG画像の共通レスポンスオプションを返す
 *
 * @returns {ConstructorParameters<typeof ImageResponse>[1]} 画像サイズとキャッシュヘッダー
 */
function imageOptions(): ConstructorParameters<typeof ImageResponse>[1] {
  return {
    ...OG_IMAGE_SIZE,
    emoji: 'twemoji',
    headers: {
      'Cache-Control': 'public, immutable, max-age=31536000',
    },
  };
}

/**
 * 環境に応じてOG画像内で参照する絶対URLの基点を返す
 *
 * @param {NextRequest} req リクエスト
 * @returns {string} アセット参照用のベースURL
 */
function getBaseUrl(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return siteConfig.url.replace(/\/$/, '');
  }

  const host = req.headers.get('host');
  if (!host) return siteConfig.url.replace(/\/$/, '');

  const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  return `${isLocal ? 'http' : 'https'}://${host}`;
}

/**
 * public 配下のアセットパスをOG画像から読める絶対URLへ変換する
 *
 * @param {string} baseUrl ベースURL
 * @param {string} path アセットパス
 * @returns {string} 絶対URL
 */
function getAssetUrl(baseUrl: string, path: string) {
  if (/^https?:\/\//.test(path)) return path;
  return `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
}

/**
 * 文字列を指定位置で分割する
 *
 * @param {string} text イベント名
 * @param {number[]} breakpoints 分割位置
 * @returns {string[]} 分割済みの行
 */
function splitAtBreakpoints(text: string, breakpoints: number[]) {
  let start = 0;
  const lines = breakpoints.map((point) => {
    const line = text.slice(start, point).trim();
    start = point;
    return line;
  });
  lines.push(text.slice(start).trim());
  return lines.filter(Boolean);
}

const preferredBreakWords = [
  '飲み会',
  'バンド練習',
  '年度',
  'プロジェクト',
  'キックオフ',
  '懇親会',
  'ミーティング',
  '打ち合わせ',
  '候補日程調整',
  '候補日調整',
  '候補日',
  '日程調整',
  '日程',
  '調整',
];

const compoundWords = [
  '候補日程調整',
  '候補日調整',
  'バンド練習',
  'プロジェクト',
  'キックオフ',
  '新作確認',
  '確認イベント',
  'ミーティング',
  '打ち合わせ',
  '懇親会',
  '飲み会',
  '日程調整',
  '候補日',
];

const particles = ['の', 'と', 'で', 'へ', 'に', 'を', 'が'];

/**
 * カタカナかどうかを判定する
 *
 * @param {string} char 1文字
 * @returns {boolean} カタカナの場合 true
 */
function isKatakana(char: string) {
  return /^[\u30A0-\u30FFー]$/.test(char);
}

/**
 * 英数字かどうかを判定する
 *
 * @param {string} char 1文字
 * @returns {boolean} 英数字の場合 true
 */
function isAlphaNumeric(char: string) {
  return /^[A-Za-z0-9]$/.test(char);
}

/**
 * OG画像上の見た目幅に近い概算長を返す
 *
 * @param {string} text イベント名
 * @returns {number} 日本語1文字を1とした概算幅
 */
function getVisualLength(text: string) {
  return Array.from(text).reduce((sum, char) => {
    if (isAlphaNumeric(char)) return sum + 0.58;
    if (/^[\u{1F300}-\u{1FAFF}]$/u.test(char)) return sum + 1.15;
    if (/^[\s・×!！?？.,、。:：|｜/／_-]$/.test(char)) return sum + 0.45;
    return sum + 1;
  }, 0);
}

/**
 * OG画像で扱いやすいように空白と制御文字を整える
 *
 * @param {string} text イベント名
 * @returns {string} OG画像に描画するタイトル
 */
function sanitizeTitleForOg(text: string) {
  return text
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 単語途中での不自然な改行かどうかを判定する
 *
 * @param {string} text イベント名
 * @param {number} index 分割位置
 * @returns {boolean} 避けるべき分割の場合 true
 */
function isAwkwardBreak(text: string, index: number) {
  const before = text[index - 1] ?? '';
  const after = text[index] ?? '';
  const kinsokuAfter = ['ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ゃ', 'ゅ', 'ょ', 'っ', 'ー'];

  if (kinsokuAfter.includes(after)) return true;
  if (isKatakana(before) && isKatakana(after)) return true;
  if (isAlphaNumeric(before) && isAlphaNumeric(after)) return true;

  return false;
}

/**
 * 日本語タイトルを語単位に分割する
 *
 * @param {string} text イベント名
 * @returns {string[]} 語単位の配列
 */
function segmentJapaneseTitle(text: string) {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
    return [...segmenter.segment(text)].map((segment) => segment.segment.trim()).filter(Boolean);
  }

  return Array.from(text);
}

/**
 * Intl.Segmenter が細かく分けすぎる語をOG向けに結合する
 *
 * @param {string[]} tokens 語単位の配列
 * @returns {string[]} 結合後の語単位配列
 */
function mergeCompoundTokens(tokens: string[]) {
  const merged: string[] = [];
  let index = 0;

  while (index < tokens.length) {
    let matchedWord = '';
    let matchedEnd = index;

    for (let end = Math.min(tokens.length, index + 5); end > index; end -= 1) {
      const candidate = tokens.slice(index, end).join('');
      if (compoundWords.includes(candidate)) {
        matchedWord = candidate;
        matchedEnd = end;
        break;
      }
    }

    if (matchedWord) {
      merged.push(matchedWord);
      index = matchedEnd;
      continue;
    }

    merged.push(tokens[index]);
    index += 1;
  }

  return merged;
}

/**
 * 語境界として自然な位置にスコアを付ける
 *
 * @param {string[]} tokens 語単位の配列
 * @param {number} tokenIndex 分割位置
 * @returns {number} 分割位置の自然さ
 */
function scoreTokenBreak(tokens: string[], tokenIndex: number) {
  const before = tokens[tokenIndex - 1] ?? '';
  const after = tokens[tokenIndex] ?? '';
  const beforeText = tokens.slice(0, tokenIndex).join('');
  const afterText = tokens.slice(tokenIndex).join('');
  const highPriorityBefore = ['、', '・', '/', '／', '|', '｜', ':', '：', '-'];

  if (afterText === '日程調整' || afterText === '候補日調整') return 44;
  if (particles.includes(before) && (after === '日程調整' || after === '候補日調整')) return 40;
  if (particles.includes(before)) return 24;
  if (preferredBreakWords.some((word) => beforeText.endsWith(word))) return 22;
  if (highPriorityBefore.some((mark) => before.endsWith(mark))) return 18;
  if (after === '日程調整' || after === '候補日調整') return 16;
  return 0;
}

/**
 * よくあるイベント名サフィックスを意味のまとまりで分割する
 *
 * @param {string} text イベント名
 * @param {number} lineCount 目標行数
 * @returns {string[] | null} 定型分割できる場合の行
 */
function splitCommonEventSuffix(text: string, lineCount: number) {
  const suffixes = ['の日程調整', '候補日程調整', '候補日調整', '日程調整'];

  for (const suffix of suffixes) {
    if (!text.endsWith(suffix)) continue;

    const prefix = text.slice(0, -suffix.length);
    if (prefix.length < 2) continue;

    if (suffix === 'の日程調整') {
      const prefixLines =
        lineCount <= 2 || prefix.length <= 16
          ? [`${prefix}の`]
          : splitTitleIntoLineCount(`${prefix}の`, lineCount - 1);
      return [...prefixLines, '日程調整'];
    }

    const prefixLines =
      lineCount <= 2 || prefix.length <= 16
        ? [prefix]
        : splitTitleIntoLineCount(prefix, lineCount - 1);
    return [...prefixLines, suffix];
  }

  return null;
}

/**
 * 指定行数で最も読みやすい改行位置を探索する
 *
 * @param {string} text イベント名
 * @param {number} lineCount 行数
 * @returns {string[]} 分割済みの行
 */
function splitTitleIntoLineCount(text: string, lineCount: number) {
  if (lineCount <= 1) return [text];

  const tokens = mergeCompoundTokens(segmentJapaneseTitle(text));
  if (tokens.length <= lineCount) return tokens;

  const length = text.length;
  const idealLineLength = length / lineCount;
  const maxComfortableLength =
    lineCount >= 4 ? 12 : lineCount === 3 ? 14 : Math.ceil(idealLineLength) + 5;
  let bestLines: string[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;

  const search = (startToken: number, lines: string[], breakScore: number) => {
    const remainingLines = lineCount - lines.length;

    if (remainingLines === 1) {
      const lastLine = tokens.slice(startToken).join('');
      const candidate = [...lines, lastLine].filter(Boolean);
      const lineLengths = candidate.map((line) => line.length);
      const longest = Math.max(...lineLengths);
      const shortest = Math.min(...lineLengths);
      const balancePenalty = (longest - shortest) * 5;
      const overflowPenalty = Math.max(0, longest - maxComfortableLength) * 16;
      const orphanPenalty = lineLengths.some((length) => length <= 2) ? 120 : 0;
      const score = breakScore - balancePenalty - overflowPenalty - orphanPenalty - longest;

      if (score > bestScore) {
        bestScore = score;
        bestLines = candidate;
      }
      return;
    }

    const remainingTokenCount = tokens.length - startToken;
    const maxEndToken = tokens.length - remainingLines + 1;
    const minEndToken = startToken + 1;
    const remainingTextLength = tokens.slice(startToken).join('').length;
    const ideal = remainingTextLength / remainingLines;

    if (remainingTokenCount < remainingLines) return;

    for (let endToken = minEndToken; endToken <= maxEndToken; endToken += 1) {
      const line = tokens.slice(startToken, endToken).join('');
      if (!line) continue;

      const nextLineMinLength = tokens[endToken]?.length ?? 0;
      const lineLength = line.length;
      const distancePenalty = Math.abs(lineLength - ideal) * 2.8;
      const localBreakScore = scoreTokenBreak(tokens, endToken);
      const overflowPenalty = Math.max(0, lineLength - maxComfortableLength) * 10;
      const shortPenalty = lineLength <= 2 || nextLineMinLength <= 1 ? 80 : 0;
      search(
        endToken,
        [...lines, line],
        breakScore + localBreakScore - distancePenalty - overflowPenalty - shortPenalty,
      );
    }
  };

  search(0, [], 0);

  if (bestLines.length === lineCount) return bestLines;

  const minLineLength = Math.max(3, Math.floor(length / lineCount) - 3);
  let bestBreakpoints: number[] = [];
  const maxLineLength = Math.ceil(length / lineCount) + 5;
  let fallbackBestScore = Number.NEGATIVE_INFINITY;

  const fallbackSearch = (start: number, breakpoints: number[]) => {
    const remainingLines = lineCount - breakpoints.length;

    if (remainingLines === 1) {
      const candidate = splitAtBreakpoints(text, breakpoints);
      const lineLengths = candidate.map((line) => line.length);
      const longest = Math.max(...lineLengths);
      const shortest = Math.min(...lineLengths);
      const balancePenalty = (longest - shortest) * 5;
      const awkwardPenalty = breakpoints.some((point) => isAwkwardBreak(text, point)) ? 120 : 0;
      const score = -balancePenalty - awkwardPenalty - longest;

      if (score > fallbackBestScore) {
        fallbackBestScore = score;
        bestBreakpoints = breakpoints;
      }
      return;
    }

    const remainingLength = length - start;
    const ideal = Math.round(remainingLength / remainingLines);
    const from = Math.max(start + minLineLength, start + ideal - 6);
    const to = Math.min(length - minLineLength * (remainingLines - 1), start + ideal + 6);

    for (let point = from; point <= to; point += 1) {
      const lineLength = point - start;
      if (lineLength < minLineLength || lineLength > maxLineLength) continue;
      fallbackSearch(point, [...breakpoints, point]);
    }
  };

  fallbackSearch(0, []);
  return splitAtBreakpoints(text, bestBreakpoints);
}

/**
 * 長すぎるイベント名をOG画像内で読める長さに丸める
 *
 * @param {string} text イベント名
 * @param {number} maxLength 最大文字数
 * @returns {{ text: string; truncated: boolean }} 丸めた文字列と省略有無
 */
function truncateTitleForOg(text: string, maxLength: number) {
  if (text.length <= maxLength) return { text, truncated: false };
  return { text: `${text.slice(0, maxLength - 1)}…`, truncated: true };
}

/**
 * イベント名をOG画像用に改行し、文字サイズを決める
 *
 * @param {string} rawTitle イベント名
 * @returns {{ lines: string[]; fontSize: number; lineHeight: number }} 描画用の行と組版値
 */
function formatEventTitle(rawTitle: string) {
  const sanitizedTitle = sanitizeTitleForOg(rawTitle) || 'イベント';
  const { text, truncated } = truncateTitleForOg(sanitizedTitle, 50);
  const visualLength = getVisualLength(text);
  let lineCount = visualLength <= 8.5 ? 1 : visualLength <= 22 ? 2 : visualLength <= 36 ? 3 : 4;

  if (!truncated && text.endsWith('の日程調整')) {
    const prefixLength = text.slice(0, -'の日程調整'.length).length;
    if (prefixLength > 16) lineCount = Math.max(lineCount, 3);
    if (prefixLength > 28) lineCount = Math.max(lineCount, 4);
  }

  if (
    !truncated &&
    (text.endsWith('日程調整') || text.endsWith('候補日調整') || text.endsWith('候補日程調整'))
  ) {
    const suffixLength = text.endsWith('候補日程調整')
      ? '候補日程調整'.length
      : text.endsWith('候補日調整')
        ? '候補日調整'.length
        : '日程調整'.length;
    const prefixLength = text.slice(0, -suffixLength).length;
    if (prefixLength > 18) lineCount = Math.max(lineCount, 3);
    if (prefixLength > 30) lineCount = Math.max(lineCount, 4);
  }

  const fixedSuffixLines = !truncated ? splitCommonEventSuffix(text, lineCount) : null;
  const lines = fixedSuffixLines ?? splitTitleIntoLineCount(text, lineCount);
  const longestLineLength = Math.max(...lines.map((line) => line.length));

  if (lines.length === 1) {
    const visualLineLength = getVisualLength(lines[0] ?? '');
    const fontSize = visualLineLength <= 6 ? 98 : 88;
    return { lines, fontSize, lineHeight: 1.04 };
  }
  if (lines.length === 2) {
    return { lines, fontSize: longestLineLength <= 13 ? 78 : 74, lineHeight: 1.08 };
  }
  if (lines.length === 3) {
    return { lines, fontSize: truncated ? 56 : 58, lineHeight: 1.1 };
  }
  return { lines, fontSize: 44, lineHeight: 1.08 };
}

/**
 * OG画像生成API
 *
 * @param {NextRequest} req リクエスト
 * @returns イベント画像またはトップページ用画像へのリダイレクト
 */
export function GET(req: NextRequest) {
  const searchParams = new URL(req.url).searchParams;
  const type = searchParams.get('type');
  if (type === 'event') {
    const logoUrl = getAssetUrl(getBaseUrl(req), siteConfig.ogImage);
    const title = searchParams.get('title') || 'イベント';
    const { lines, fontSize, lineHeight } = formatEventTitle(title);

    return new ImageResponse(
      <Shell>
        <div
          style={{
            display: 'flex',
            position: 'relative',
            flexDirection: 'column',
            justifyContent: 'center',
            zIndex: 2,
            width: 840,
            height: 500,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              color: palette.ink,
            }}
          >
            <span style={{ color: palette.primary, fontSize: 34, fontWeight: 900 }}>
              {siteConfig.name.full}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: lines.length === 1 ? 0 : 6,
              color: palette.ink,
              fontSize,
              fontWeight: 900,
              lineHeight,
              margin: '30px 0 24px',
              wordBreak: 'break-word',
            }}
          >
            {lines.map((line, index) => (
              <span key={`${line}-${index}`} style={{ display: 'block', whiteSpace: 'nowrap' }}>
                {line}
              </span>
            ))}
          </div>
          <p
            style={{
              color: palette.muted,
              fontSize: 30,
              fontWeight: 700,
              lineHeight: 1.36,
              margin: 0,
            }}
          >
            すぐに回答。すぐに調整。
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            zIndex: 1,
            right: 38,
            top: 150,
            alignItems: 'center',
            justifyContent: 'flex-end',
            opacity: 0.68,
          }}
        >
          <LayerMark logoUrl={logoUrl} scale={0.82} />
        </div>
      </Shell>,
      imageOptions(),
    );
  }

  return new Response(null, { status: 307, headers: { Location: HOME_OG_IMAGE.url } });
}
