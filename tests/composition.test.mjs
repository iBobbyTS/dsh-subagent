import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import composition from '../preset-composition.cjs';

const { profileSpawnPreset } = composition;
const nativeTool = (provider, toolName) => ({ id: `tool-${provider}`,
  name: '@deepseek-ai/dsh-tool-subagent', config: { provider, toolName, modelSelectionSettings: true, maxDepth: 1 } });

function fixture() {
  return { id: 'standard', order: 1, plugins: [
    { id: 'shell', name: 'shell', disabled: { __jsExpr: "process.platform === 'win32'" } },
    { id: 'delegation', name: 'cordis:group', group: true, isolate: { workflowEngine: true }, config: [
      nativeTool('spawn', 'subagent'), nativeTool('fork', 'subagent_fork'),
      { id: 'list', name: '@deepseek-ai/dsh-tool-subagent-control/list-agents' },
      { id: 'control', name: '@deepseek-ai/dsh-tool-subagent-control' },
      { id: 'workflow', name: '@deepseek-ai/dsh-workflow-ptc', config: { provider: 'spawn' } },
    ] },
  ] };
}

test('moves only native spawn model selection out of the Agent layer, preserving native fallback and controls', () => {
  const before = fixture();
  const untouched = structuredClone(before);
  const after = profileSpawnPreset(before);
  const expected = structuredClone(before);
  expected.plugins[1].config[0].config.modelSelectionSettings = false;
  assert.deepEqual(after, expected);
  assert.deepEqual(before, untouched, 'must not mutate the original declaration');
  assert.equal(after.plugins[1].config[1], before.plugins[1].config[1], 'fork stays native');
  assert.equal(after.plugins[0], before.plugins[0], 'Loader expressions stay inert');
});

test('refuses missing or ambiguous native spawn definitions instead of silently leaving a conflicting preset', () => {
  const missing = fixture();
  missing.plugins[1].config.shift();
  assert.throws(() => profileSpawnPreset(missing), /found 0/);
  const duplicate = fixture();
  duplicate.plugins.push(nativeTool('spawn', 'subagent'));
  assert.throws(() => profileSpawnPreset(duplicate), /found 2/);
});

test('leaves other spawn tool names and provider configuration intact', () => {
  const input = fixture();
  input.plugins.push(nativeTool('spawn', 'other_spawn'));
  const output = profileSpawnPreset(input);
  assert.equal(output.plugins[2], input.plugins[2]);
  assert.equal(output.plugins[1].config[0].config.maxDepth, 1);
});

test('bundle patches cover only the shipped presets with spawn and include required package exports', () => {
  const patch = parse(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => ({ __jsExpr: value }) }],
  });
  assert.deepEqual(patch.filter(row => row.id).map(row => row.id), ['preset-standard', 'preset-ptc', 'preset-cordis']);
  for (const row of patch.filter(row => row.id)) {
    assert.equal(row.config.id, row.id.slice('preset-'.length));
    assert.ok(Array.isArray(row.config.plugins), 'preset carriers require literal config, not a whole-config expression');
    assert.deepEqual(row.config, profileSpawnPreset(row.config));
  }
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(manifest.files.includes('preset-composition.cjs'));
});

const runtime = process.env.DSH_TEST_RUNTIME_ANCHOR;
test('installed Web release presets retain expressions and all native neighbors', { skip: !runtime }, () => {
  const requireRuntime = createRequire(runtime);
  for (const id of ['standard', 'ptc', 'cordis']) {
    const output = composition.installedPreset(requireRuntime, id);
    assert.equal(output.id, id);
    const source = readFileSync(requireRuntime.resolve(`@deepseek-ai/dsh-web-app/presets/${id}.patch.yml`), 'utf8');
    const original = parse(source, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => ({ __jsExpr: value }) }] })[0].insert[0].config;
    assert.deepEqual(output, profileSpawnPreset(original));
    const shipped = parse(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), {
      customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => ({ __jsExpr: value }) }],
    }).find(row => row.id === `preset-${id}`);
    assert.deepEqual(shipped.config, output, 'committed bundle must match the selected runtime except spawn model selection');
    assert.ok(JSON.stringify(output).includes('__jsExpr'));
  }
});
