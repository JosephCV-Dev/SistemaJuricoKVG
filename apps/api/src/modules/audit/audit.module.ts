import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { KvgAuditRepository } from './infrastructure/kvg-audit.repository';
import { AuditController } from './presentation/audit.controller';

@Module({
  imports: [SupabaseModule],
  controllers: [AuditController],
  providers: [KvgAuditRepository],
})
export class AuditModule {}
