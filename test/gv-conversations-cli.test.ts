import fs from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('gv-conversations CLI wiring', () => {
  test('exposes an npm command that lists Google Voice conversations', () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts?: Record<string, string> };
    const cli = fs.readFileSync(new URL('../src/cli.ts', import.meta.url), 'utf8');

    expect(pkg.scripts?.['gv-conversations']).toContain('src/cli.ts gv-conversations');
    expect(cli).toContain("command === 'gv-conversations'");
    expect(cli).toContain("service.listConversations('google_voice'");
  });

  test('CLI commands terminate after printing even when a CDP socket remains open', () => {
    const cli = fs.readFileSync(new URL('../src/cli.ts', import.meta.url), 'utf8');

    expect(cli).toContain('function printAndExit');
    expect(cli).toContain('process.stdout.write');
    expect(cli).toContain('process.exit(0)');
  });
});
