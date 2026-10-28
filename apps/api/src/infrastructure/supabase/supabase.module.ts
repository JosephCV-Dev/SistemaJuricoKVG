import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KvgRpcService } from './kvg-rpc.service';
import { SupabaseClientFactory } from './supabase-client.factory';

@Module({
  imports: [ConfigModule],
  providers: [SupabaseClientFactory, KvgRpcService],
  exports: [KvgRpcService],
})
export class SupabaseModule {}
