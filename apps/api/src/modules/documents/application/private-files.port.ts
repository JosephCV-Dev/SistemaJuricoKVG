export abstract class PrivateFiles {
  abstract authorizeReception(id: string): Promise<void>;
  abstract completeReception(id: string, size: number): Promise<void>;
  abstract authorizeDelivery(
    id: string,
  ): Promise<{ path: string; size: number }>;
  abstract read(
    bucket: 'kvg-cuarentena' | 'kvg-originales',
    path: string,
  ): Promise<Buffer>;
  abstract putImmutable(
    bucket: 'kvg-cuarentena' | 'kvg-originales',
    path: string,
    bytes: Buffer,
    mime: string,
  ): Promise<void>;
}
