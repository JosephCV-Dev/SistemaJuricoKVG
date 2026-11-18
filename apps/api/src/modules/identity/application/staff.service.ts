import { Injectable } from '@nestjs/common';
import type { StaffDeactivation, StaffRevisionInput } from '@kvg/contracts';
import { StaffAuth, StaffRepository } from './staff.ports';

@Injectable()
export class StaffService {
  constructor(
    readonly repository: StaffRepository,
    private readonly auth: StaffAuth,
  ) {}

  async sendInvitation(token: string, userId: string) {
    await this.auth.invite(
      await this.repository.invitationEmail(token, userId),
    );
    return { accepted: true };
  }
  async deactivate(
    token: string,
    userId: string,
    input: StaffRevisionInput,
  ): Promise<StaffDeactivation> {
    const { account, authId } = await this.repository.deactivate(
      token,
      userId,
      input,
    );
    return { account, providerBlocked: await this.block(authId) };
  }
  async retryBlock(token: string, userId: string) {
    return {
      providerBlocked: await this.block(
        await this.repository.disabledAuthId(token, userId),
      ),
    };
  }
  private async block(authId: string | null) {
    return authId ? this.auth.block(authId).catch(() => false) : null;
  }
}
