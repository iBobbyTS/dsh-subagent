import assert from 'node:assert/strict'
import test from 'node:test'
import { assertProfiles, Config } from '../index.js'

test('defaults declare follow-conversation routing and explicit effort policies', () => {
  const config = Config({})
  assert.deepEqual(config.profiles.map(profile => profile.name), ['fast', 'reviewer'])
  assert.deepEqual(config.profiles[0], {
    name: 'fast',
    description: 'Quick lookups, lightweight checks, short summaries.',
    backend: 'spawn',
    modelRouting: { mode: 'follow-conversation' },
    reasoning: { mode: 'custom', effort: 'low' },
  })
  assert.deepEqual(config.profiles[1], {
    name: 'reviewer',
    description: 'Conversation-aware review and continuation work at high effort.',
    backend: 'fork',
    modelRouting: { mode: 'follow-conversation' },
    reasoning: { mode: 'custom', effort: 'high' },
  })
  assert.equal('toolFilter' in config.profiles[0], false)
})

test('explicit profile route keeps atomic Provider, Model, and reasoning policies', () => {
  const config = Config({
    profiles: [{
      name: 'research',
      backend: 'spawn',
      modelRouting: {
        mode: 'custom',
        provider: 'opencode-zen',
        model: 'x-preview-f-free',
      },
      reasoning: { mode: 'custom', effort: 'max' },
    }],
  })
  assert.deepEqual(config.profiles[0], {
    name: 'research',
    backend: 'spawn',
    modelRouting: {
      mode: 'custom',
      provider: 'opencode-zen',
      model: 'x-preview-f-free',
    },
    reasoning: { mode: 'custom', effort: 'max' },
  })
})

test('rejects partial custom routing and reasoning policies', () => {
  assert.throws(() => Config({
    profiles: [{
      name: 'missing-model',
      modelRouting: { mode: 'custom', provider: 'openai-codex' },
      reasoning: { mode: 'follow-conversation' },
    }],
  }))
  assert.throws(() => Config({
    profiles: [{
      name: 'missing-effort',
      modelRouting: { mode: 'follow-conversation' },
      reasoning: { mode: 'custom' },
    }],
  }))
})

test('default profile designation validates against live profile names', () => {
  assert.equal(Config({}).defaultProfile, undefined)

  const profiles = [{
    name: 'fast',
    modelRouting: { mode: 'follow-conversation' },
    reasoning: { mode: 'follow-conversation' },
  }]
  const designated = Config({ profiles, defaultProfile: 'fast' })
  assert.equal(designated.defaultProfile, 'fast')

  assert.doesNotThrow(() => assertProfiles({ profiles, defaultProfile: 'fast' }))
  assert.throws(
    () => assertProfiles({ profiles, defaultProfile: 'ghost' }),
    /defaultProfile "ghost" does not match any profile/,
  )
  assert.throws(() => Config({ profiles, defaultProfile: 'Bad Name' }))
})

test('rejects legacy flat routing settings', () => {
  assert.throws(() => Config({
    profiles: [{
      name: 'legacy',
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'max',
    }],
  }))
})
