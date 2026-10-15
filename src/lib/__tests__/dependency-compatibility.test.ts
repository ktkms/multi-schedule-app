import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const requireFromHere = createRequire(__filename);
const { loadNycConfig } = requireFromHere('@istanbuljs/load-nyc-config') as {
  loadNycConfig(options: { cwd: string }): Promise<Record<string, unknown>>;
};
const { quote, parse } = requireFromHere('shell-quote') as {
  quote(tokens: (string | { comment: string })[]): string;
  parse(command: string): unknown[];
};

describe('依存更新後の互換性', () => {
  it.each(['\n', '\r', '\u2028', '\u2029'])(
    'コメント後の改行文字 %j によるコマンド注入を拒否する',
    (lineTerminator) => {
      expect(() => quote([{ comment: 'comment' }, `${lineTerminator}echo injected`])).toThrow(
        TypeError,
      );
    },
  );

  it('空白・引用符・シェル構文を含む引数を文字列のまま保持する', () => {
    const args = ['two words', "it's quoted", '$(echo injected)', ''];
    expect(parse(quote(args))).toEqual(args);
  });

  it('YAML形式のカバレッジ設定の継承と配列への正規化を維持する', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'daysynth-nyc-'));

    try {
      await writeFile(join(directory, 'package.json'), '{}');
      await writeFile(join(directory, 'base.yaml'), 'all: true\nexclude: fixture/**\n');
      await writeFile(
        join(directory, '.nycrc.yaml'),
        'extends: ./base.yaml\ncheck-coverage: true\nlines: 80\ninclude: src/**\n',
      );

      await expect(loadNycConfig({ cwd: directory })).resolves.toMatchObject({
        cwd: directory,
        all: true,
        checkCoverage: true,
        lines: 80,
        include: ['src/**'],
        exclude: ['fixture/**'],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('SVGの画像変換とPNGのリサイズを維持する', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>',
    );
    const png = await sharp(svg).png().toBuffer();
    const { data, info } = await sharp(png)
      .resize(4, 4)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(info).toMatchObject({ width: 4, height: 4, channels: 3 });
    expect([...data.subarray(0, 3)]).toEqual([255, 0, 0]);
  });
});
