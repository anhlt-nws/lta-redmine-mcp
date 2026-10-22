import { ProjectAccessPolicy } from './project-access.policy';
import { RedmineError } from './redmine.errors';

const policy = new ProjectAccessPolicy({
  redmineUrl: 'x',
  port: 1,
  maxFileMb: 5,
  blockedProjectIds: new Set([12]),
});

it('isBlocked', () => {
  expect(policy.isBlocked(12)).toBe(true);
  expect(policy.isBlocked(13)).toBe(false);
});

it('assertAllowed throws Not found', () => {
  expect(() => policy.assertAllowed(12)).toThrow(new RedmineError('Not found'));
  expect(() => policy.assertAllowed(13)).not.toThrow();
});

it('filter drops blocked items', () => {
  expect(
    policy
      .filter([
        { id: 1, project: { id: 12 } },
        { id: 2, project: { id: 13 } },
      ])
      .map((i) => i.id),
  ).toEqual([2]);
});
