import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { IdentityModule } from '../identity/identity.module';
import { CasesRepository } from './application/cases.repository';
import { CasesService } from './application/cases.service';
import { KvgCasesRepository } from './infrastructure/kvg-cases.repository';
import { CasesController } from './presentation/cases.controller';

@Module({
  imports: [SupabaseModule, IdentityModule],
  controllers: [CasesController],
  providers: [
    CasesService,
    { provide: CasesRepository, useClass: KvgCasesRepository },
  ],
})
export class CasesModule {}
