import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { notFound } from './redmine.errors';

@Injectable()
export class ProjectAccessPolicy {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  isBlocked(projectId: number): boolean {
    return this.config.blockedProjectIds.has(projectId);
  }

  assertAllowed(projectId: number): void {
    if (this.isBlocked(projectId)) throw notFound();
  }

}
