import { documentUploadMode } from '../dist/config/document-upload-mode.js';
import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import { PrivateFileGateway } from '../dist/modules/documents/infrastructure/private-file-gateway.js';
import { DocumentWorker } from '../dist/modules/operations/application/document-worker.js';
import { IsolatedFileVerifier } from '../dist/modules/operations/infrastructure/isolated-file-verifier.js';
import { readFile } from 'node:fs/promises';
import { writeFile, chmod } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  developmentConfig,
  localDirectory,
  DevelopmentSetupError,
  reportSetupFailure,
} from './lib/development-database.mjs';
import {
  developmentTotp,
  readDevelopmentFixture,
} from './lib/development-identities.mjs';

let browser,
  stage = 'CONFIGURACION';
const contexts = [];
const checks = [];
function check(condition, description) {
  if (!condition)
    throw new DevelopmentSetupError(`Comprobación no superada: ${description}`);
  checks.push(description);
}
try {
  const config = await developmentConfig();
  if (documentUploadMode(process.env) !== 'verified')
    throw new DevelopmentSetupError(
      'Prueba documental pospuesta: las cargas están pausadas.',
    );
  const fixture = await readDevelopmentFixture(config);
  if (!process.env.PLAYWRIGHT_MODULE_PATH)
    throw new DevelopmentSetupError(
      'Indica PLAYWRIGHT_MODULE_PATH de la herramienta externa de prueba.',
    );
  const origin = process.env.APP_ORIGIN;
  if (origin !== 'http://127.0.0.1:5173')
    throw new DevelopmentSetupError(
      'La prueba de navegador requiere el origen local documentado.',
    );
  const { chromium } = await import(
    pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
  );
  browser = await chromium.launch({ headless: true });
  const errors = [];
  async function login(role) {
    const account = fixture.accounts.find((account) => account.role === role);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    contexts.push(context);
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', () => errors.push('javascript_error'));
    await page.goto(origin);
    await page
      .getByLabel('Correo electrónico', { exact: true })
      .fill(account.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
    await page
      .getByRole('button', { name: 'Iniciar sesión', exact: true })
      .click();
    await page
      .getByRole('heading', { name: 'Verificación en dos pasos' })
      .waitFor();
    await page
      .getByLabel('Código de seis dígitos')
      .fill(developmentTotp(account.totpSecret));
    await page
      .getByRole('button', { name: 'Verificar código', exact: true })
      .click();
    await page.getByRole('heading', { name: 'Inicio', exact: true }).waitFor();
    await page
      .getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('button', { name: 'Mi sesión', exact: true })
      .click();
    await page
      .getByText(`Sesión iniciada: ${account.name}.`, { exact: true })
      .waitFor();
    check(true, `login_y_mfa_en_navegador_${role}`);
    return { context, page };
  }
  stage = 'FORMULARIOS';
  const { page, context } = await login('SECRETARIA');
  await page.getByRole('button', { name: 'Inicio', exact: true }).click();
  await page
    .getByRole('button', { name: 'Nuevo cliente', exact: true })
    .click();
  const name = `Cliente navegador ficticio ${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Nombre completo', { exact: true }).fill(name);
  await page
    .getByLabel('Correo (opcional)', { exact: true })
    .fill('cliente.navegador@example.com');
  await page
    .getByRole('button', { name: 'Revisar datos del cliente', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Confirmar registro', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Confirmar registro de cliente', exact: true })
    .click();
  await page.getByRole('heading', { name, level: 1, exact: true }).waitFor();
  check(true, 'alta_cliente_con_revision_confirmacion_y_detalle');
  await page
    .getByRole('button', { name: 'Crear expediente', exact: true })
    .click();
  await page
    .getByLabel('Descripción', { exact: true })
    .fill('Asunto ficticio verificado por navegador.');
  await page
    .getByRole('button', { name: 'Revisar datos del expediente', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Confirmar apertura', exact: true })
    .waitFor();
  await page
    .getByRole('button', {
      name: 'Confirmar creación de expediente',
      exact: true,
    })
    .click();
  const heading = page.getByRole('heading', { name: /^Expediente KVG-/ });
  await heading.waitFor();
  const folio = (await heading.innerText()).replace('Expediente ', '');
  check(/^KVG-\d{4}-\d{10}$/.test(folio), 'alta_expediente_con_folio_generado');
  check(
    await page.getByText('Sin abogado asignado.', { exact: true }).isVisible(),
    'expediente_nuevo_sin_asignacion_fingida',
  );

  await page.getByRole('button', { name: 'Historial', exact: true }).click();
  check(
    await page
      .getByRole('heading', { name: 'Historial de estados', exact: true })
      .isVisible(),
    'seccion_historial_accesible',
  );
  await page.getByRole('button', { name: 'Avances', exact: true }).click();
  check(
    await page
      .getByText('Sin avances registrados.', { exact: true })
      .isVisible(),
    'seccion_avances_sin_datos_inventados',
  );
  await page.getByRole('button', { name: 'Resumen', exact: true }).click();
  const desktopScreenshot = `${localDirectory}/records-browser-desktop.png`;
  await page.screenshot({ path: desktopScreenshot, fullPage: true });
  await chmod(desktopScreenshot, 0o600);
  check(
    await page
      .locator('.brand img')
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    'logo_local_cargado',
  );
  stage = 'DOCUMENTOS';
  await page
    .locator('.detail-tabs')
    .getByRole('button', { name: 'Documentos', exact: true })
    .click();
  await page
    .getByText('Este expediente no tiene documentos visibles.', { exact: true })
    .waitFor();
  await page.getByText('Subir documento', { exact: true }).click();
  const file = await sharp({
    create: { width: 16, height: 16, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
  await page.getByLabel('Archivo', { exact: true }).setInputFiles({
    name: 'prueba-navegador.png',
    mimeType: 'image/png',
    buffer: file,
  });
  await page
    .getByLabel('Nombre del documento', { exact: true })
    .fill('Archivo navegador ficticio');
  const category = await page
    .locator('#document-category option')
    .nth(1)
    .getAttribute('value');
  await page.getByLabel('Categoría', { exact: true }).selectOption(category);
  await page
    .getByRole('button', { name: 'Enviar a análisis', exact: true })
    .click();
  await page
    .getByText('Estado de la carga: En análisis.', { exact: true })
    .waitFor();
  check(true, 'carga_binaria_desde_formulario');
  const worker = new DocumentWorker(
    new PrivateFileGateway(new ConfigService(process.env)),
    new IsolatedFileVerifier('127.0.0.1', 3310),
  );
  check(
    (await worker.once()) === 'published',
    'analisis_real_del_archivo_del_navegador',
  );
  await page
    .getByRole('button', { name: 'Actualizar documentos', exact: true })
    .click();
  await page
    .getByText('Estado de la carga: Archivo disponible.', { exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Archivo navegador ficticio', exact: true })
    .click();
  await page
    .getByRole('heading', {
      name: 'Documento: Archivo navegador ficticio',
      exact: true,
    })
    .waitFor();
  const downloadEvent = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Descargar original', exact: true })
    .click();
  const downloaded = await downloadEvent;
  check(
    (await readFile(await downloaded.path())).equals(file),
    'descarga_desde_interfaz_conserva_original',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    'documentos_movil_sin_desbordamiento',
  );
  await page.screenshot({
    path: `${localDirectory}/documents-browser-mobile.png`,
    fullPage: true,
  });
  await chmod(`${localDirectory}/documents-browser-mobile.png`, 0o600);
  await page.setViewportSize({ width: 1280, height: 900 });
  stage = 'PERSISTENCIA_Y_MOVIL';
  await page.reload();
  await page.getByRole('button', { name: 'Expedientes', exact: true }).click();
  await page.getByLabel('Folio o descripción', { exact: true }).fill(folio);
  await page
    .getByRole('button', { name: 'Buscar expedientes', exact: true })
    .click();
  await page
    .getByRole('button', { name: `Consultar expediente ${folio}`, exact: true })
    .click();
  await page
    .getByRole('heading', { name: `Expediente ${folio}`, exact: true })
    .waitFor();
  check(true, 'sesion_y_expediente_persisten_al_recargar');
  check(
    await page.evaluate(
      () => localStorage.length === 0 && sessionStorage.length === 0,
    ),
    'sin_tokens_ni_datos_en_storage_del_navegador',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    'vista_movil_sin_desbordamiento_horizontal',
  );
  await page.getByRole('button', { name: 'Resumen', exact: true }).focus();
  await page.keyboard.press('Tab');
  check(
    await page.evaluate(
      () => getComputedStyle(document.activeElement).outlineStyle !== 'none',
    ),
    'foco_visible_de_teclado',
  );
  const screenshot = `${localDirectory}/records-browser-mobile.png`;
  await page.screenshot({ path: screenshot, fullPage: true });
  await chmod(screenshot, 0o600);
  await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  await page.getByRole('button', { name: 'Mi sesión', exact: true }).click();
  await page
    .getByRole('button', { name: 'Cerrar sesión', exact: true })
    .click();
  await page.getByLabel('Contraseña', { exact: true }).waitFor();
  check(
    (await context.request.get(origin + '/api/v1/clients')).status() === 401,
    'logout_de_navegador_invalida_acceso',
  );
  check(
    (await page
      .getByRole('heading', { name: 'Área de trabajo', exact: true })
      .count()) === 0,
    'logout_limpia_contenido_privado',
  );

  stage = 'ADMINISTRACION_SIN_ACCESO_JURIDICO';
  const admin = await login('ADMINISTRADOR');
  await admin.page
    .getByRole('navigation')
    .getByRole('button', { name: 'Usuarios y permisos', exact: true })
    .waitFor();
  check(
    (await admin.page
      .getByRole('button', { name: 'Revisar datos del cliente', exact: true })
      .count()) === 0,
    'interfaz_refleja_capacidades_del_administrador',
  );
  check(
    (await admin.context.request.get(origin + '/api/v1/cases')).status() ===
      403,
    'servidor_deniega_al_administrador_aunque_envie_url',
  );
  check(errors.length === 0, 'sin_errores_javascript');
  const report = {
    date: '2026-11-04',
    result: 'passed',
    checks,
    browser: await browser.version(),
    environment: 'development-local',
    realDataUsed: false,
  };
  await writeFile(
    `${localDirectory}/records-browser-verification.json`,
    JSON.stringify(report, null, 2) + '\n',
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      resultado: 'correcto',
      comprobaciones: checks.length,
      detalle: checks,
      datos_reales: false,
      credenciales_publicadas: false,
    }),
  );
} catch (error) {
  reportSetupFailure(stage, error);
  process.exitCode = 1;
} finally {
  for (const context of contexts) {
    try {
      const csrf = await context.request.get(
        process.env.APP_ORIGIN + '/api/v1/auth/csrf',
      );
      const body = await csrf.json();
      await context.request.post(
        process.env.APP_ORIGIN + '/api/v1/auth/logout',
        {
          headers: {
            Origin: process.env.APP_ORIGIN,
            'X-CSRF-Token': body.csrfToken,
          },
          data: {},
        },
      );
    } catch {
      /* cierre de prueba sin publicar errores del navegador */
    }
  }
  await browser?.close().catch(() => undefined);
}
