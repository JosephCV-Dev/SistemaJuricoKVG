import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { IdentityModule } from '../identity/identity.module';
import { KvgConfigurationRepository } from './infrastructure/kvg-configuration.repository';
import { ConfigurationController } from './presentation/configuration.controller';

@Module({
  imports: [SupabaseModule, IdentityModule],
  controllers: [ConfigurationController],
  providers: [KvgConfigurationRepository],
})
export class ConfigurationModule {}
