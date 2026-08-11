import { Global, Module } from '@nestjs/common';
import { SnapshotService } from './snapshot.service';

@Global()
@Module({
  providers: [SnapshotService],
  exports: [SnapshotService],
})
export class DomainModule {}
