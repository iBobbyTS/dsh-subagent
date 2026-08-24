/** Package-owned invariant companion for the configurable subagent profile bundle. */

const PACKAGE_NAME = 'dsh-subagent'

export const name = 'dsh-subagent-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: the bundle owns settings and reversible Agent-scoped
 * tool/slot registrations; their lifecycle is verified by composition tests.
 */
export function apply(ctx) {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, () => {}))
}
