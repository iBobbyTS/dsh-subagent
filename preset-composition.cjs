const { readFileSync, writeFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { parse, stringify } = require('yaml');

/**
 * Keep the installed release's complete preset, including Loader expressions.
 * Only the native spawn tool's per-Agent model-selection registration changes:
 * fixed TOML profiles own that selection, and the native fallback stays in the
 * preset's ancestor layer where an Agent-scoped tool can legally shadow it.
 */
function profileSpawnPreset(config) {
  let matches = 0;
  const visit = rows => rows.map(row => {
    if (row.name === '@deepseek-ai/dsh-tool-subagent'
        && row.config?.provider === 'spawn'
        && (row.config.toolName ?? 'subagent') === 'subagent') {
      matches++;
      return { ...row, config: { ...row.config, modelSelectionSettings: false } };
    }
    if (row.group === true && Array.isArray(row.config)) {
      return { ...row, config: visit(row.config) };
    }
    return row;
  });
  const plugins = visit(config.plugins);
  if (matches !== 1) throw new Error(`dsh-subagent: expected one native spawn tool in preset ${config.id}; found ${matches}`);
  return { ...config, plugins };
}

function installedPreset(requireFromRuntime, id) {
  if (!['standard', 'ptc', 'cordis'].includes(id)) throw new Error(`dsh-subagent: unsupported shipped preset ${id}`);
  const source = readFileSync(requireFromRuntime.resolve(`@deepseek-ai/dsh-web-app/presets/${id}.patch.yml`), 'utf8');
  const rows = parse(source, { customTags: [{
    tag: 'tag:yaml.org,2002:js', resolve: value => ({ __jsExpr: value }),
  }] });
  const config = rows.flatMap(row => row.insert ?? [row]).find(row => row.id === `preset-${id}`)?.config;
  if (!config || config.id !== id || !Array.isArray(config.plugins)) {
    throw new Error(`dsh-subagent: invalid installed preset ${id}`);
  }
  return profileSpawnPreset(config);
}

function bundlePatch(requireFromRuntime) {
  return ['standard', 'ptc', 'cordis'].map(id => ({
    id: `preset-${id}`, name: '@deepseek-ai/dsh-agent-preset',
    config: installedPreset(requireFromRuntime, id),
  })).concat([{ insert: [{ id: 'dsh-subagent', name: 'dsh-subagent' }] }]);
}

module.exports = { profileSpawnPreset, installedPreset, bundlePatch };

if (require.main === module) {
  if (!process.env.DSH_TEST_RUNTIME_ANCHOR) throw new Error('Set DSH_TEST_RUNTIME_ANCHOR to the installed DSH entry file');
  const runtime = createRequire(process.env.DSH_TEST_RUNTIME_ANCHOR);
  const version = runtime('@deepseek-ai/dsh-web-app/package.json').version;
  const output = stringify(bundlePatch(runtime), { lineWidth: 0, customTags: [{
    tag: 'tag:yaml.org,2002:js', identify: value => value && typeof value.__jsExpr === 'string',
    stringify: item => JSON.stringify(item.value.__jsExpr),
  }] });
  writeFileSync(require('node:path').join(__dirname, 'cordis.patch.yml'),
    `# Generated from @deepseek-ai/dsh-web-app ${version} (MIT).\n`
    + '# Only native spawn modelSelectionSettings changes; all other preset rows are preserved.\n'
    + '# Regenerate with npm run generate:presets when updating the supported DSH release.\n' + output);
}
