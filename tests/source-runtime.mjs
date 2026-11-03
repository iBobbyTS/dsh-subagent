import { registerHooks, createRequire } from 'node:module';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ts from 'typescript';

/** Test-only source runner: never use installed DSH packages as substitutes.
 * TypeScript's standard-decorator transform matches the reference Vitest setup.
 * An optional installation anchor supplies third-party dependencies only.
 */
export function sourceRuntime(root) {
  root = resolve(root);
  const parsed = ts.parseConfigFileTextToJson('tsconfig.base.json', readFileSync(join(root, 'tsconfig.base.json'), 'utf8'));
  if (parsed.error) throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'));
  const paths = Object.entries(parsed.config.compilerOptions.paths).sort(([a], [b]) => b.length - a.length);
  const external = [createRequire(import.meta.url), ...(process.env.DSH_TEST_EXTERNAL_ANCHOR
    ? [createRequire(resolve(process.env.DSH_TEST_EXTERNAL_ANCHOR))] : [])];
  function sourcePath(specifier) {
    for (const [pattern, candidates] of paths) {
      const star = pattern.indexOf('*');
      let suffix;
      if (star < 0) { if (pattern !== specifier) continue; }
      else {
        if (!specifier.startsWith(pattern.slice(0, star)) || !specifier.endsWith(pattern.slice(star + 1))) continue;
        suffix = specifier.slice(star, specifier.length - (pattern.length - star - 1));
      }
      const base = resolve(root, candidates[0].replace('*', suffix ?? ''));
      for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return pathToFileURL(candidate).href;
      }
      throw new Error(`Source alias ${specifier} points to a missing source file: ${base}`);
    }
  }
  let resolvingExternal = false;
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (resolvingExternal) return nextResolve(specifier, context);
      const source = sourcePath(specifier);
      if (source) return nextResolve(source, context);
      if (specifier.startsWith('@deepseek-ai/')) throw new Error(`Unmapped source package: ${specifier}`);
      try { return nextResolve(specifier, context); }
      catch (error) {
        if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes(':')) throw error;
        let resolved;
        resolvingExternal = true;
        try {
          let failure;
          for (const require of external) {
            try { resolved = require.resolve(specifier); break; }
            catch (error) { failure = error; }
          }
          if (!resolved) throw failure;
        } finally { resolvingExternal = false; }
        return nextResolve(pathToFileURL(resolved).href, context);
      }
    },
    load(url, context, nextLoad) {
      if (url.startsWith(pathToFileURL(`${root}${sep}`).href) && /\.tsx?$/.test(url)) {
        const fileName = fileURLToPath(url);
        const result = ts.transpileModule(readFileSync(fileName, 'utf8'), { fileName,
          compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX } });
        return { format: 'module', source: result.outputText, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
  return { load: specifier => import(sourcePath(specifier) ?? specifier),
    file: relative => import(pathToFileURL(resolve(root, relative)).href),
    dispose: () => hook.deregister() };
}
