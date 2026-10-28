import { BadGatewayException } from '@nestjs/common';

export function invalidRpcResult(): never {
  throw new BadGatewayException(
    'El servicio de datos no cumple el contrato esperado.',
  );
}
export function rpcRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return invalidRpcResult();
  return value as Record<string, unknown>;
}
export function rpcText(value: unknown): string {
  if (typeof value !== 'string' || !value.length) return invalidRpcResult();
  return value;
}
export function rpcNullableText(value: unknown): string | null {
  return value === null ? null : rpcText(value);
}
export function rpcDate(value: unknown): string {
  const text = rpcText(value);
  if (!Number.isFinite(Date.parse(text))) return invalidRpcResult();
  return text;
}
export function rpcInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    return invalidRpcResult();
  return value;
}
export function rpcArray<T>(value: unknown, read: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) return invalidRpcResult();
  return value.map(read);
}
