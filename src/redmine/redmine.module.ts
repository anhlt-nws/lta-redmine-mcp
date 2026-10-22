import { Module } from '@nestjs/common';
import { ProjectAccessPolicy } from './project-access.policy';
import { RedmineGateway } from './redmine.gateway';

@Module({
  providers: [RedmineGateway, ProjectAccessPolicy],
  exports: [RedmineGateway, ProjectAccessPolicy],
})
export class RedmineModule {}
