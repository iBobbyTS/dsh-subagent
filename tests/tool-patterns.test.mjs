import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProfile, assertToolNames, resolveToolFilter, isToolPattern, ProfileError } from '../lib/profile-core.js';

const base = { provider: 'fixture', model: 'model', reasoning_effort: 'high' };
const profile = fields => validateProfile('patterns', { ...base, ...fields });
const tools = [
  'read', 'edit', 'send_message',
  'mcp__playwright__browser_click', 'mcp__playwright__browser_type',
  'mcp__serena__find_symbol',
];
function rejectsCode(fn, code) { assert.throws(fn, error => error instanceof ProfileError && error.code === code); }

test('a wildcard selects a whole tool namespace without touching its neighbours', () => {
  assert.deepEqual(resolveToolFilter(profile({ tool_blacklist: ['mcp__playwright__*'] }), tools),
    { deny: ['mcp__playwright__browser_click', 'mcp__playwright__browser_type'] });
  assert.deepEqual(resolveToolFilter(profile({ tool_blacklist: ['mcp__*__find_symbol'] }), tools).deny,
    ['mcp__serena__find_symbol']);
  // A pattern without the separator is a different namespace.
  assert.deepEqual(resolveToolFilter(profile({ tool_blacklist: ['serena__*'] }), tools).deny, []);
});

test('wildcards expand inside whitelists and still retain native messaging', () => {
  const filter = resolveToolFilter(profile({ tool_whitelist: ['read', 'mcp__playwright__*'] }), tools);
  assert.deepEqual(filter.allow, ['mcp__playwright__browser_click', 'mcp__playwright__browser_type', 'read', 'send_message']);
  assert.equal(filter.allow.includes('structured_output'), false);
});

test('a whole-tool wildcard grants no tool that the child does not have', () => {
  const available = [...tools, 'structured_output'];
  const filter = resolveToolFilter(profile({ tool_whitelist: ['*'] }), available);
  assert.deepEqual(filter.allow, [...new Set([...tools, 'send_message'])].sort());
  assert.equal(filter.allow.includes('structured_output'), false);
});

test('a wildcard never reaches the protected tools through a blacklist', () => {
  for (const entry of ['*', 'send_*', '*_message', 'structured_*', 'send_message*']) {
    rejectsCode(() => profile({ tool_blacklist: [entry] }), 'PROTECTED_TOOL_BLACKLIST');
  }
  assertToolNames(profile({ tool_blacklist: ['mcp__*'] }), tools);
});

test('a blacklist pattern may guard a namespace that is not mounted yet', () => {
  const guard = profile({ tool_blacklist: ['mcp__serena__*'] });
  assertToolNames(guard, ['read', 'send_message']);
  assert.deepEqual(resolveToolFilter(guard, ['read', 'send_message']).deny, []);
});

test('exact names and whitelist patterns must select a mounted tool', () => {
  rejectsCode(() => assertToolNames(profile({ tool_blacklist: ['dom'] }), tools), 'TOOL_NOT_FOUND');
  rejectsCode(() => assertToolNames(profile({ tool_whitelist: ['mcp__serena__*'] }), ['read', 'send_message']), 'TOOL_NOT_FOUND');
  // Names stay case-sensitive; a wildcard does not normalize them.
  rejectsCode(() => assertToolNames(profile({ tool_whitelist: ['MCP__*'] }), tools), 'TOOL_NOT_FOUND');
});

test('only * is special, it matches an empty run, and metacharacters stay literal', () => {
  assert.equal(isToolPattern('read'), false);
  assert.equal(isToolPattern('read*'), true);
  assert.deepEqual(resolveToolFilter(profile({ tool_blacklist: ['read*'] }), tools).deny, ['read']);
  const dotted = profile({ tool_blacklist: ['mcp.serena'] });
  assertToolNames(dotted, ['mcp.serena', 'mcpXserena', 'send_message']);
  assert.deepEqual(resolveToolFilter(dotted, ['mcp.serena', 'mcpXserena']).deny, ['mcp.serena']);
  // `?` and regex syntax are not wildcards.
  rejectsCode(() => assertToolNames(profile({ tool_whitelist: ['rea?'] }), tools), 'TOOL_NOT_FOUND');
  rejectsCode(() => assertToolNames(profile({ tool_whitelist: ['rea.'] }), tools), 'TOOL_NOT_FOUND');
});
