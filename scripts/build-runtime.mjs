import { build } from 'tsdown'
import { rmSync } from 'node:fs'

// Only this package's generated runtime directory is owned by this build.
rmSync('lib', { recursive: true, force: true })
await build({
  entry: ["src/index.ts", "src/profile-core.ts", "src/profile-runtime.ts", "src/profile-store.ts"], outDir: 'lib', root: 'src', unbundle: true,
  platform: 'node', format: 'esm', outExtensions: () => ({ js: '.js' }), target: 'node22', sourcemap: true,
  clean: false, dts: false, deps: { neverBundle: [/.*/] },
})
