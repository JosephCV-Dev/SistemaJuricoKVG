import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DocumentsService } from '../dist/modules/documents/application/documents.service.js';
import { DocumentWorker } from '../dist/modules/operations/application/document-worker.js';
import { RejectedContent } from '../dist/modules/documents/domain/document.types.js';
import { FileContentVerifier } from '../dist/modules/operations/infrastructure/file-content-verifier.js';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { crc32 } from 'node:zlib';

import { DocumentUploadPolicy } from '../dist/modules/documents/application/document-upload-policy.js';
const verifiedUploads = new DocumentUploadPolicy('verified');
const bytes = Buffer.from('contenido ficticio');
const sha = createHash('sha256').update(bytes).digest('hex');
const status = {
  id: 'id',
  documentId: 'document',
  state: 'RECIBIENDO',
  versionId: null,
  result: null,
  caseId: 'case',
};
function ports() {
  const calls = [];
  let state = status;
  return {
    calls,
    setStatus: (s) => (state = s),
    repository: {
      upload: async () => {
        calls.push('user');
        return state;
      },
      authorizeDownload: async () => {
        calls.push('user');
        return { id: 'authorization', size: bytes.length, sha256: sha };
      },
    },
    files: {
      authorizeReception: async () => {
        calls.push('destination');
      },
      completeReception: async () => {
        calls.push('received');
      },
      putImmutable: async () => {
        calls.push('put');
      },
      read: async () => {
        calls.push('read');
        return bytes;
      },
      authorizeDelivery: async () => {
        calls.push('delivery');
        return { path: 'versiones/id/original', size: bytes.length };
      },
    },
  };
}
test('no transfiere ni inspecciona Storage si falla el alcance ordinario', async () => {
  const p = ports();
  p.repository.upload = async () => {
    throw new ForbiddenException();
  };
  await assert.rejects(
    new DocumentsService(p.repository, p.files, verifiedUploads).receive(
      'user',
      'id',
      bytes,
    ),
    ForbiddenException,
  );
  assert.deepEqual(p.calls, []);
});
test('recepción autoriza antes del objeto y revalida antes de confirmar', async () => {
  const p = ports();
  await new DocumentsService(p.repository, p.files, verifiedUploads).receive(
    'user',
    'id',
    bytes,
  );
  assert.deepEqual(p.calls, [
    'user',
    'destination',
    'put',
    'user',
    'received',
    'user',
  ]);
});
test('una revocación durante la transferencia impide confirmar recepción', async () => {
  const p = ports();
  let reads = 0;
  p.repository.upload = async () => {
    if (++reads > 1) throw new ForbiddenException();
    return status;
  };
  await assert.rejects(
    new DocumentsService(p.repository, p.files, verifiedUploads).receive(
      'user',
      'id',
      bytes,
    ),
    ForbiddenException,
  );
  assert(!p.calls.includes('received'));
});
test('reintentar no sobrescribe una carga ya recibida con bytes distintos', async () => {
  const p = ports();
  p.setStatus({ ...status, state: 'PENDIENTE_VERIFICACION' });
  await assert.rejects(
    new DocumentsService(p.repository, p.files, verifiedUploads).receive(
      'user',
      'id',
      Buffer.from('diferente'),
    ),
    (e) => e.status === 409,
  );
  assert(!p.calls.includes('put'));
});
test('con cargas pausadas la descarga valida hash y reautoriza el original', async () => {
  const p = ports();
  assert.deepEqual(
    await new DocumentsService(
      p.repository,
      p.files,
      new DocumentUploadPolicy(),
    ).download('user', 'version'),
    bytes,
  );
  assert.deepEqual(p.calls, ['user', 'delivery', 'read', 'delivery']);
});
test('no devuelve un objeto cuyo hash cambió', async () => {
  const p = ports();
  p.files.read = async () => Buffer.from('alterado');
  await assert.rejects(
    new DocumentsService(p.repository, p.files, verifiedUploads).download(
      'user',
      'version',
    ),
    (e) => e.status === 503,
  );
});
test('revocar durante la descarga impide entregar los bytes al controlador', async () => {
  const p = ports();
  let n = 0;
  p.files.authorizeDelivery = async () => {
    if (++n > 1) throw new ForbiddenException();
    return { path: 'path', size: bytes.length };
  };
  await assert.rejects(
    new DocumentsService(p.repository, p.files, verifiedUploads).download(
      'user',
      'version',
    ),
    ForbiddenException,
  );
});
function workerPorts() {
  const calls = [];
  const files = {
    execute: async (op) => {
      calls.push(op);
      if (op === 'trabajo.tomar_carga')
        return { trabajo_id: 'job', ejecutor_codigo: 'lease' };
      if (op === 'trabajo.datos')
        return {
          carga: {
            localizador_cuarentena: 'source',
            tamano_recibido_bytes: bytes.length,
            nombre_original: 'archivo.pdf',
          },
          localizador_destino: 'target',
        };
      if (op === 'carga.publicar' || op === 'carga.publicar_beta')
        return { estado: 'COMPLETADO', version_id: 'version' };
      return {};
    },
    read: async () => bytes,
    putImmutable: async () => calls.push('put'),
  };
  return { files, calls };
}
test('fallo del analizador deja el trabajo para reintento y nunca publica', async () => {
  const p = workerPorts();
  const worker = new DocumentWorker(p.files, {
    verify: async () => {
      throw new Error('sin antivirus');
    },
  });
  assert.equal(await worker.once(), 'retry');
  assert(p.calls.includes('trabajo.fallar'));
  assert(!p.calls.includes('carga.publicar'));
  assert(!p.calls.includes('put'));
});
test('contenido rechazado no se copia a originales', async () => {
  const p = workerPorts();
  assert.equal(
    await new DocumentWorker(p.files, {
      verify: async () => {
        throw new RejectedContent();
      },
    }).once(),
    'rejected',
  );
  assert(p.calls.includes('carga.rechazar'));
  assert(!p.calls.includes('put'));
});
test('publicación se hace tras análisis, copia y verificación', async () => {
  const p = workerPorts();
  assert.equal(
    await new DocumentWorker(p.files, {
      verify: async () => ({
        size: bytes.length,
        sha256: sha,
        format: 'PDF',
        mime: 'application/pdf',
        engine: 'solo-prueba-local',
      }),
    }).once(),
    'published',
  );
  assert(p.calls.indexOf('put') < p.calls.indexOf('carga.publicar'));
});
const scanner = { scan: async () => 'solo-puerto-local-no-antimalware-real' };
test('analizador estructural decodifica PDF, PNG y JPG y rechaza extensión falsa', async () => {
  const verifier = new FileContentVerifier(scanner);
  const pdf = await PDFDocument.create();
  pdf.addPage();
  assert.equal(
    (await verifier.verify(Buffer.from(await pdf.save()), 'ficticio.pdf'))
      .format,
    'PDF',
  );
  for (const format of ['png', 'jpeg']) {
    const image = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#fff' },
    })
      .toFormat(format)
      .toBuffer();
    assert.equal(
      (await verifier.verify(image, `ficticio.${format}`)).format,
      format === 'png' ? 'PNG' : 'JPG',
    );
    await assert.rejects(verifier.verify(image, 'falso.pdf'), RejectedContent);
  }
});
test('rechaza cabecera de PDF truncada y texto renombrado', async () => {
  const verifier = new FileContentVerifier(scanner);
  await assert.rejects(
    verifier.verify(Buffer.from('%PDF-1.7\n roto'), 'roto.pdf'),
    RejectedContent,
  );
  await assert.rejects(
    verifier.verify(Buffer.from('texto'), 'falso.png'),
    RejectedContent,
  );
});
function zip(entries) {
  const local = [],
    central = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const n = Buffer.from(name),
      b = Buffer.from(value),
      h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc32(b), 14);
    h.writeUInt32LE(b.length, 18);
    h.writeUInt32LE(b.length, 22);
    h.writeUInt16LE(n.length, 26);
    local.push(h, n, b);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc32(b), 16);
    c.writeUInt32LE(b.length, 20);
    c.writeUInt32LE(b.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += h.length + n.length + b.length;
  }
  const cd = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
const docx = {
  '[Content_Types].xml':
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels':
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="word/document.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/></Relationships>',
  'word/document.xml':
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Texto ficticio</w:t></w:r></w:p></w:body></w:document>',
};
test('DOCX valida estructura OOXML y rechaza macros, referencias externas y XML con entidades', async () => {
  const verifier = new FileContentVerifier(scanner);
  assert.equal(
    (await verifier.verify(zip(docx), 'ficticio.docx')).format,
    'DOCX',
  );
  for (const extra of [
    { 'word/vbaProject.bin': 'macro' },
    {
      '_rels/.rels':
        '<Relationships><Relationship TargetMode="External" Target="https://example.com"/></Relationships>',
    },
    {
      'word/document.xml':
        '<!DOCTYPE d [<!ENTITY e SYSTEM "file:///etc/passwd">]><d>&e;</d>',
    },
  ])
    await assert.rejects(
      verifier.verify(zip({ ...docx, ...extra }), 'ficticio.docx'),
      RejectedContent,
    );
});

test('beta publica con operación separada y no afirma resultado antimalware', async () => {
  const p = workerPorts();
  const execute = p.files.execute;
  let publication;
  p.files.execute = async (operation, input) => {
    if (operation === 'trabajo.tomar_carga_beta')
      return execute('trabajo.tomar_carga', input);
    if (operation === 'carga.publicar_beta') publication = input;
    return execute(operation, input);
  };
  const worker = new DocumentWorker(
    p.files,
    {
      verify: async () => ({
        size: bytes.length,
        sha256: sha,
        format: 'PDF',
        mime: 'application/pdf',
        engine: null,
      }),
    },
    true,
  );
  assert.equal(await worker.once(), 'published');
  assert.equal(publication.sha256, sha);
  assert(!Object.hasOwn(publication, 'antimalware_apto'));
  assert(!Object.hasOwn(publication, 'motor_version'));
  assert(!p.calls.includes('carga.publicar'));
});

test('el modo normal no entrega originales beta aunque el broker devuelva la autorización', async () => {
  const p = ports();
  p.files.authorizeDelivery = async () => ({
    beta: true,
    path: 'versiones/id/original',
    size: bytes.length,
  });
  await assert.rejects(
    new DocumentsService(p.repository, p.files, verifiedUploads).download(
      'user',
      'version',
    ),
    ForbiddenException,
  );
  assert(!p.calls.includes('read'));
  assert.deepEqual(
    await new DocumentsService(
      p.repository,
      p.files,
      new DocumentUploadPolicy('beta'),
    ).download('user', 'version'),
    bytes,
  );
});

test('el trabajador registra una cancelación de publicación sin reintentar ni anunciar versión', async () => {
  const p = workerPorts();
  const execute = p.files.execute;
  p.files.execute = async (operation, input) => {
    if (operation === 'carga.publicar')
      return { estado: 'CANCELADO', resultado: 'CONFLICTO_REVISION' };
    return execute(operation, input);
  };
  const worker = new DocumentWorker(p.files, {
    verify: async () => ({
      size: bytes.length,
      sha256: sha,
      format: 'PDF',
      mime: 'application/pdf',
      engine: 'solo-prueba-local',
    }),
  });
  assert.equal(await worker.once(), 'cancelled');
  assert(!p.calls.includes('trabajo.fallar'));
});
