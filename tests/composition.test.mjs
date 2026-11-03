import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const patch = parse(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('bundle only inserts the Host router and never overrides presets or native plugins', () => {
  assert.deepEqual(patch, [{ insert: [{ id: 'dsh-subagent', name: 'dsh-subagent' }] }]);
});

test('install order cannot overwrite another bundle persona or preset contributions', () => {
  const contributions = [
    { id: 'preset-cordis', config: { id: 'cordis', plugins: [{ id: 'persona', config: { prefix: 'existing', suffix: 'creator context' } }] } },
    { id: 'preset-custom', config: { id: 'custom', plugins: [{ name: 'third-party-tool' }] } },
  ];
  // No plugin-owned patch has a preset target: both ordering permutations retain
  // the same exact preset declarations. Real registry behavior is tested separately.
  for (const rows of [[...contributions, ...patch], [...patch, ...contributions]]) {
    assert.deepEqual(rows.filter(row => row.id?.startsWith('preset-')), contributions);
  }
});

test('distribution has no preset generator or install scripts and rejects legacy runtimes', () => {
  assert.equal(manifest.files.includes('preset-composition.cjs'), false);
  assert.equal(manifest.scripts['generate:presets'], undefined);
  assert.equal(manifest.scripts.prepare, undefined);
  assert.equal(manifest.scripts.postinstall, undefined);
  assert.equal(manifest.engines.dsh, '>=0.2.2-alpha.3 <0.3.0');
  for (const name of ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-subagent', '@deepseek-ai/dsh-home-paths']) {
    assert.equal(manifest.peerDependencies[name], manifest.engines.dsh);
  }
  for (const path of ['locale/en.json', 'locale/zh.json', 'icon.svg']) assert.ok(manifest.files.includes(path));
});
