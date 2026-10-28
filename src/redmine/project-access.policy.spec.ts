import { ProjectAccessPolicy } from './project-access.policy';
import { RedmineError } from './redmine.errors';

const make = () => new ProjectAccessPolicy({
  redmineUrl: 'x',
  port: 1,
  maxFileMb: 5,
  transport: 'http',
  blockedProjectIds: new Set([12]),
  blockedIdentifiers: new Set(['nws-sale']),
});

it('isBlocked', () => {
  const policy = make();
  expect(policy.isBlocked(12)).toBe(true);
  expect(policy.isBlocked(13)).toBe(false);
});

it('assertAllowed throws Not found', () => {
  const policy = make();
  expect(() => policy.assertAllowed(12)).toThrow(new RedmineError('Not found'));
  expect(() => policy.assertAllowed(13)).not.toThrow();
});

it('identifiers stay pending until resolved, then block their id', () => {
  const policy = make();
  expect(policy.pendingIdentifiers()).toEqual(['nws-sale']);
  policy.resolveIdentifier('nws-sale', 42);
  expect(policy.pendingIdentifiers()).toEqual([]);
  expect(policy.isBlocked(42)).toBe(true);
});
