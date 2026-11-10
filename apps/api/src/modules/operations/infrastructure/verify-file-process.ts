import { ClamAvScanner } from './clamav-scanner';
import { FileContentVerifier } from './file-content-verifier';
import {
  MAX_FILE_BYTES,
  RejectedContent,
} from '../../documents/domain/document.types';
async function run() {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const c of process.stdin) {
    length += (c as Buffer).length;
    if (length > MAX_FILE_BYTES) throw new RejectedContent();
    chunks.push(c as Buffer);
  }
  const verifier = new FileContentVerifier(
    new ClamAvScanner(
      process.env.CLAMAV_HOST ?? '127.0.0.1',
      Number(process.env.CLAMAV_PORT ?? 3310),
    ),
  );
  const verified = await verifier.verify(
    Buffer.concat(chunks),
    process.env.KVG_FILE_NAME ?? '',
  );
  process.stdout.write(JSON.stringify({ status: 'verified', verified }));
}
void run().catch((error) => {
  process.stdout.write(
    JSON.stringify({
      status: error instanceof RejectedContent ? 'rejected' : 'unavailable',
    }),
  );
  process.exitCode = 1;
});
