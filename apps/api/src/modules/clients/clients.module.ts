import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { IdentityModule } from '../identity/identity.module';
import { ClientsRepository } from './application/clients.repository';
import { ClientsService } from './application/clients.service';
import { KvgClientsRepository } from './infrastructure/kvg-clients.repository';
import { ClientsController } from './presentation/clients.controller';

@Module({
  imports: [SupabaseModule, IdentityModule],
  controllers: [ClientsController],
  providers: [
    ClientsService,
    { provide: ClientsRepository, useClass: KvgClientsRepository },
  ],
})
export class ClientsModule {}
