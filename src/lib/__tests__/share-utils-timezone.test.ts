import { spawnSync } from 'node:child_process';
import path from 'node:path';

describe('共有候補の端末タイムゾーン独立性', () => {
  it.each(['UTC', 'Asia/Tokyo', 'America/New_York', 'Europe/Berlin'])(
    '%sでも候補・連続時間・日付またぎの結果が同じになる',
    (timeZone) => {
      // TZはJest内で切り替えず、実際の日時処理を別プロセスの起動時から検証する。
      const result = spawnSync(
        process.execPath,
        [
          path.join(process.cwd(), 'node_modules/jest/bin/jest.js'),
          '--runInBand',
          '--runTestsByPath',
          'src/lib/__tests__/share-utils.test.ts',
          '--silent',
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, TZ: timeZone },
          encoding: 'utf-8',
          timeout: 30_000,
        },
      );
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`${timeZone}\n${result.stdout}\n${result.stderr}`);
      expect(result.status).toBe(0);
    },
    35_000,
  );
});
