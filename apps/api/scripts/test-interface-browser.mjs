import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  developmentConfig,
  DevelopmentSetupError,
  reportSetupFailure,
} from './lib/development-database.mjs';
import {
  developmentTotp,
  readDevelopmentFixture,
} from './lib/development-identities.mjs';

let browser;
let stage = 'CONFIGURACION';
const errors = [];

try {
  const config = await developmentConfig();
  const fixture = await readDevelopmentFixture(config);
  const origin = 'http://127.0.0.1:5173';
  if (!process.env.PLAYWRIGHT_MODULE_PATH || process.env.APP_ORIGIN !== origin)
    throw new DevelopmentSetupError(
      'Configura Playwright externo y usa el origen local documentado.',
    );
  const { chromium } = await import(
    pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
  );
  browser = await chromium.launch({ headless: true });

  async function open(role, width) {
    const account = fixture.accounts.find((person) => person.role === role);
    assert.ok(account?.totpSecret);
    const page = await browser.newPage({ viewport: { width, height: 768 } });
    page.on('pageerror', () => errors.push('ERROR_JS'));
    await page.goto(origin);
    await page
      .getByRole('img', { name: 'KVG Asesores Corporativos' })
      .waitFor();
    await fits(page);
    await page
      .getByLabel('Correo electrónico', { exact: true })
      .fill(account.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
    await page
      .getByRole('button', { name: 'Iniciar sesión', exact: true })
      .click();
    await page
      .getByLabel('Código de seis dígitos')
      .fill(developmentTotp(account.totpSecret));
    await page
      .getByRole('button', { name: 'Verificar código', exact: true })
      .click();
    await page.getByRole('heading', { name: 'Inicio', level: 1 }).waitFor();
    return page;
  }

  async function fits(page) {
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  }

  function menu(page) {
    return page.getByRole('navigation', { name: 'Navegación principal' });
  }

  async function navigate(page, name, title = name) {
    const openMenu = page.getByRole('button', {
      name: 'Abrir menú',
      exact: true,
    });
    if (await openMenu.isVisible()) await openMenu.click();
    await menu(page).getByRole('button', { name, exact: true }).click();
    const heading = page.getByRole('heading', {
      name: title,
      level: 1,
      exact: true,
    });
    await heading.waitFor();
    await page.waitForFunction(
      () => document.activeElement?.id === 'page-heading',
    );
    await fits(page);
  }

  async function openDocument(page) {
    const rows = page.getByRole('region', {
      name: 'Resultados de búsqueda documental',
    });
    const response = page.waitForResponse(
      (item) =>
        /\/api\/v1\/documents\/[a-f0-9-]{36}$/.test(
          new URL(item.url()).pathname,
        ) && item.request().method() === 'GET',
    );
    await rows.getByRole('button').first().click();
    const loaded = await response;
    assert.equal(loaded.status(), 200);
    const data = await loaded.json();
    assert.equal(data.fileAvailable, true);
    assert.doesNotMatch(
      JSON.stringify(data),
      /sha256|carga_id|authorId|localizador/i,
    );
    await page.getByRole('heading', { name: data.name, exact: true }).waitFor();
    await page
      .getByRole('button', { name: 'Descargar original', exact: true })
      .waitFor();
    assert.equal(await rows.isVisible(), false);
    await fits(page);
    return data;
  }

  async function openClientProfile(page, trigger) {
    const pending = page.waitForResponse(
      (response) =>
        /\/api\/v1\/clients\/[a-f0-9-]{36}$/.test(
          new URL(response.url()).pathname,
        ) && response.request().method() === 'GET',
    );
    await trigger.click();
    const response = await pending;
    assert.equal(response.status(), 200);
    const profile = await response.json();
    const heading = page.getByRole('heading', {
      name: profile.name,
      exact: true,
      level: 1,
    });
    await heading.waitFor();
    assert.equal(await heading.locator('[data-icon="person"]').count(), 1);
    assert.equal(await page.getByText(profile.id, { exact: true }).count(), 0);
    if (profile.contacts.length) {
      await page
        .getByRole('heading', { name: 'Datos de contacto', exact: true })
        .waitFor();
    }
    if (profile.identifications.length) {
      await page
        .getByRole('heading', { name: 'Identificaciones', exact: true })
        .waitFor();
    }
    if (!profile.contacts.length && !profile.identifications.length) {
      await page
        .getByText(
          'Este cliente aún no tiene datos de contacto ni identificaciones registrados.',
          { exact: true },
        )
        .waitFor();
    }
    await fits(page);
    return profile;
  }

  stage = 'ACTIVACION_MOVIL';
  const invitation = await browser.newPage({
    viewport: { width: 320, height: 700 },
  });
  await invitation.goto(origin + '/activar-cuenta');
  await invitation
    .getByRole('heading', { name: 'Activar cuenta KVG' })
    .waitFor();
  await fits(invitation);
  await invitation
    .getByRole('link', { name: 'Ir al inicio de sesión' })
    .click();
  await invitation.getByLabel('Contraseña', { exact: true }).waitFor();
  await invitation.close();

  stage = 'ADMINISTRACION_MOVIL';
  const admin = await open('ADMINISTRADOR', 320);
  const toggle = admin.getByRole('button', { name: 'Abrir menú', exact: true });
  assert.equal(await menu(admin).isVisible(), false);
  await toggle.focus();
  await admin.keyboard.press('Enter');
  await menu(admin)
    .getByRole('button', { name: 'Bitácora', exact: true })
    .waitFor();
  await admin.keyboard.press('Tab');
  assert.equal(
    await admin.evaluate(() => document.activeElement?.textContent.trim()),
    'Inicio',
  );
  await admin.keyboard.press('Escape');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(
    await toggle.evaluate((element) => document.activeElement === element),
    true,
  );
  await navigate(admin, 'Bitácora');
  const table = admin.getByRole('region', { name: 'Resultados de bitácora' });
  await table.waitFor();
  assert.equal(await menu(admin).isVisible(), false);
  await table.focus();
  assert.equal(
    await table.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
    true,
  );
  await admin.keyboard.press('ArrowRight');
  await admin.waitForFunction(() => document.activeElement.scrollLeft > 0);
  await fits(admin);

  await navigate(admin, 'Configuración');
  await admin
    .getByRole('button', { name: 'Nueva categoría', exact: true })
    .click();
  const checkbox = admin.getByRole('checkbox', {
    name: 'Confirmo este cambio',
  });
  assert.equal(
    await checkbox.evaluate(
      (element) => element.getBoundingClientRect().width < 32,
    ),
    true,
  );
  await checkbox.focus();
  await admin.keyboard.press('Space');
  assert.equal(await checkbox.isChecked(), true);
  await fits(admin);
  await admin.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await navigate(admin, 'Usuarios y permisos');
  await navigate(admin, 'Mi sesión');
  await admin.getByRole('heading', { name: 'Datos de la sesión' }).waitFor();
  await admin
    .getByRole('button', { name: 'Cerrar sesión', exact: true })
    .click();
  await admin.getByLabel('Contraseña', { exact: true }).waitFor();

  stage = 'SECRETARIA_ESCRITORIO';
  const secretary = await open('SECRETARIA', 1280);
  await navigate(secretary, 'Clientes');
  const clientRow = secretary
    .getByRole('region', { name: 'Resultados de clientes', exact: true })
    .getByRole('row')
    .nth(1);
  const avatar = clientRow.locator('.entity-label > [data-icon="person"]');
  await avatar.waitFor();
  assert.equal(await avatar.getAttribute('aria-hidden'), 'true');
  await secretary.evaluate(() => document.fonts.ready.then(() => undefined));
  assert.equal(
    await avatar.evaluate((icon) => {
      const style = getComputedStyle(icon, '::before');
      return (
        style.fontFamily.includes('KVG Icons') &&
        Array.from(document.fonts).some(
          (font) =>
            font.family.includes('KVG Icons') && font.status === 'loaded',
        ) &&
        icon.getBoundingClientRect().right <
          icon.nextElementSibling.getBoundingClientRect().left
      );
    }),
    true,
  );
  const clientNavigation = menu(secretary).getByRole('button', {
    name: 'Clientes',
    exact: true,
  });
  assert.equal(
    await clientNavigation.locator('[data-icon="people"]').count(),
    1,
  );
  await openClientProfile(
    secretary,
    clientRow.getByRole('button', { name: /^Consultar cliente / }),
  );
  await secretary
    .getByRole('button', { name: 'Volver a clientes', exact: true })
    .click();
  await clientRow.waitFor();

  assert.equal(
    await menu(secretary)
      .getByRole('button', { name: 'Bitácora', exact: true })
      .count(),
    0,
  );
  assert.equal(
    await menu(secretary)
      .getByRole('button', { name: 'Configuración', exact: true })
      .count(),
    0,
  );
  await navigate(secretary, 'Expedientes');
  await navigate(secretary, 'Documentos');
  await secretary.setViewportSize({ width: 390, height: 844 });
  await fits(secretary);
  stage = 'DOCUMENTOS_SECRETARIA';
  const firstDocument = await openDocument(secretary);
  const pendingDownload = secretary.waitForEvent('download');
  await secretary
    .getByRole('button', { name: 'Descargar original', exact: true })
    .click();
  const download = await pendingDownload;
  assert.equal(
    (await stat(await download.path())).size,
    firstDocument.version.size,
  );

  const documentTabs = secretary.getByRole('group', {
    name: 'Secciones del documento',
  });
  assert.deepEqual(await documentTabs.getByRole('button').allTextContents(), [
    'Ficha',
    'Gestión documental',
    'Versiones',
    'Estado del documento',
  ]);
  assert.equal(
    await secretary
      .getByRole('button', { name: 'Retirar documento', exact: true })
      .count(),
    0,
  );
  await documentTabs
    .getByRole('button', { name: 'Gestión documental', exact: true })
    .click();
  await secretary
    .getByRole('button', { name: 'Cambiar nombre', exact: true })
    .waitFor();
  await documentTabs
    .getByRole('button', { name: 'Versiones', exact: true })
    .click();
  await secretary
    .getByRole('heading', { name: 'Historial de versiones', exact: true })
    .waitFor();
  await secretary
    .getByText('Versión ' + firstDocument.version.number + ' · Vigente', {
      exact: true,
    })
    .waitFor();
  assert.equal(await secretary.getByText(/SHA-256/i).count(), 0);
  assert.equal(
    await secretary.getByText('Datos de integridad', { exact: true }).count(),
    0,
  );
  await documentTabs
    .getByRole('button', { name: 'Estado del documento', exact: true })
    .click();
  await secretary
    .getByRole('heading', { name: /Estado de la versión/ })
    .waitFor();
  assert.equal(
    await secretary
      .getByRole('button', { name: 'Nueva revisión jurídica' })
      .count(),
    0,
  );
  await secretary
    .getByRole('button', { name: 'Abrir expediente asociado', exact: true })
    .click();
  await secretary
    .getByRole('heading', {
      name: 'Expediente ' + firstDocument.caseFolio,
      level: 1,
    })
    .waitFor();
  assert.equal(
    await secretary
      .locator('.case-summary-actions')
      .evaluate((el) => parseFloat(getComputedStyle(el).columnGap) >= 10),
    true,
  );
  await secretary
    .getByRole('button', { name: 'Responsables', exact: true })
    .click();
  await secretary
    .getByRole('heading', { name: 'Responsables vigentes', exact: true })
    .waitFor();
  await fits(secretary);
  await secretary
    .getByRole('button', { name: 'Volver a documentos', exact: true })
    .click();
  await secretary
    .getByRole('heading', { name: firstDocument.name, exact: true })
    .waitFor();
  await secretary
    .getByRole('button', { name: 'Volver a documentos', exact: true })
    .click();
  await secretary
    .getByRole('region', { name: 'Resultados de búsqueda documental' })
    .waitFor();
  await navigate(secretary, 'Mi sesión');
  await secretary
    .getByRole('button', { name: 'Cerrar sesión', exact: true })
    .click();
  await secretary.getByLabel('Contraseña', { exact: true }).waitFor();
  stage = 'EXPEDIENTES_ABOGADO';
  const lawyer = await open('ABOGADO', 390);
  await lawyer
    .getByRole('button', { name: 'Ver mis expedientes', exact: true })
    .click();
  await lawyer
    .getByRole('region', { name: 'Expedientes asignados', exact: true })
    .getByRole('button')
    .first()
    .click();
  const caseTabs = lawyer.getByRole('group', {
    name: 'Secciones del expediente',
  });
  await caseTabs.waitFor();
  assert.deepEqual(
    (await caseTabs.getByRole('button').allTextContents()).slice(0, 3),
    ['Resumen', 'Avances', 'Documentos'],
  );
  const caseHeading = await lawyer
    .getByRole('heading', { level: 1 })
    .textContent();
  const lawyerProfile = await openClientProfile(
    lawyer,
    lawyer.getByRole('button', { name: 'Consultar cliente', exact: true }),
  );
  if (!lawyerProfile.canEdit) {
    assert.equal(
      await lawyer
        .getByRole('button', { name: 'Editar cliente', exact: true })
        .count(),
      0,
    );
  }
  await lawyer
    .getByRole('button', { name: 'Volver al expediente', exact: true })
    .click();
  await lawyer
    .getByRole('heading', { name: caseHeading.trim(), level: 1, exact: true })
    .waitFor();
  await caseTabs.getByRole('button', { name: 'Avances', exact: true }).click();
  await lawyer
    .getByRole('heading', { name: 'Avances del expediente', exact: true })
    .waitFor();
  await lawyer
    .getByRole('button', { name: 'Volver a mis expedientes', exact: true })
    .click();
  await lawyer
    .getByRole('heading', { name: 'Mis expedientes', level: 1 })
    .waitFor();
  await navigate(lawyer, 'Documentos');
  await openDocument(lawyer);
  const lawyerTabs = lawyer.getByRole('group', {
    name: 'Secciones del documento',
  });
  assert.deepEqual(
    (await lawyerTabs.getByRole('button').allTextContents()).slice(0, 3),
    ['Ficha', 'Revisión y estado', 'Versiones'],
  );
  await lawyerTabs
    .getByRole('button', { name: 'Revisión y estado', exact: true })
    .click();
  await lawyer
    .getByRole('heading', { name: /Revisión y estado de la versión/ })
    .waitFor();
  await fits(lawyer);
  await lawyerTabs
    .getByRole('button', { name: 'Versiones', exact: true })
    .click();
  const integrity = lawyer
    .getByText('Datos de integridad', { exact: true })
    .first();
  await integrity.waitFor();
  assert.equal(
    await lawyer
      .getByText(/SHA-256/i)
      .first()
      .isVisible(),
    false,
  );
  await integrity.click();
  await lawyer
    .getByText(/SHA-256/i)
    .first()
    .waitFor();
  await fits(lawyer);
  await navigate(lawyer, 'Mi sesión');
  await lawyer
    .getByRole('button', { name: 'Cerrar sesión', exact: true })
    .click();
  await lawyer.getByLabel('Contraseña', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      resultado: 'correcto',
      roles: 3,
      anchuras: [320, 390, 1280],
      errores_javascript: 0,
    }),
  );
} catch (error) {
  reportSetupFailure(stage, error);
  if (error instanceof assert.AssertionError || error?.name === 'TimeoutError')
    console.error(error.message.split('\n').slice(0, 4).join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
}
