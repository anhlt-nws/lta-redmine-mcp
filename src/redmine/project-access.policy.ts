import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { notFound } from './redmine.errors';

@Injectable()
export class ProjectAccessPolicy {
  private readonly blocked: Set<number>;
  private readonly pending: Set<string>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.blocked = new Set(config.blockedProjectIds);
    this.pending = new Set(config.blockedIdentifiers);
  }

  isBlocked(projectId: number): boolean {
    return this.blocked.has(projectId);
  }

  assertAllowed(projectId: number): void {
    if (this.isBlocked(projectId)) throw notFound();
  }

  pendingIdentifiers(): string[] {
    return [...this.pending];
  }

  // Identifiers are immutable in Redmine, so a resolved id is valid for every user forever.
  resolveIdentifier(identifier: string, projectId: number): void {
    this.blocked.add(projectId);
    this.pending.delete(identifier);
  }
}
