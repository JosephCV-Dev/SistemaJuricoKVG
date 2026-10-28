import { readFile, writeFile, chmod } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import {
  localDirectory,
  DevelopmentSetupError,
} from './development-database.mjs';

export const fixturePath = `${localDirectory}/identity-development-accounts.json`;
export async function readDevelopmentFixture(config) {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  if (
    fixture.environment !== 'development' ||
    fixture.projectReference !== config.reference
  )
    throw new DevelopmentSetupError(
      'Las cuentas ficticias no corresponden al proyecto de desarrollo.',
    );
  return fixture;
}
export async function saveDevelopmentFixture(fixture) {
  await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + '\n', {
    mode: 0o600,
  });
  await chmod(fixturePath, 0o600);
}
export function developmentTotp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0)
      throw new DevelopmentSetupError('Formato TOTP de prueba inválido.');
    bits += index.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
      parseInt(bits.slice(i * 8, i * 8 + 8), 2),
    ),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, '0');
}
export async function authenticateDevelopmentAccount(identity, fixture, role) {
  const account = fixture.accounts.find((account) => account.role === role);
  if (!account)
    throw new DevelopmentSetupError('Falta la cuenta ficticia requerida.');
  let authentication = await identity.login(account.email, account.password);
  const state = await identity.state(authentication);
  authentication = state.authentication;
  if (state.state.enrollmentRequired) {
    const enrolled = await identity.enroll(authentication);
    authentication = enrolled.authentication;
    account.factorId = enrolled.enrollment.factorId;
    account.totpSecret = enrolled.enrollment.secret;
    await saveDevelopmentFixture(fixture);
  }
  if (!account.factorId || !account.totpSecret)
    throw new DevelopmentSetupError('Falta la configuración TOTP local.');
  const verified = await identity.verify(
    authentication,
    account.factorId,
    developmentTotp(account.totpSecret),
  );
  account.userId = verified.context.user.id;
  await saveDevelopmentFixture(fixture);
  return verified.authentication;
}
