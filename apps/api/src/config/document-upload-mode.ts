export function documentUploadMode(
  input: Record<string, unknown>,
  renderDemo = false,
) {
  const mode = input.DOCUMENT_UPLOAD_MODE ?? 'paused';
  if (mode !== 'paused' && mode !== 'verified' && mode !== 'beta')
    throw new Error('DOCUMENT_UPLOAD_MODE debe ser paused, verified o beta.');
  if (
    renderDemo &&
    input.NODE_ENV === 'production' &&
    input.RENDER === 'true' &&
    input.RENDER_SERVICE_TYPE === 'web' &&
    mode !== 'verified'
  ) {
    // DOCUMENT_UPLOAD_MODE=paused era la configuración de la demo anterior.
    const demoMode = input.RENDER_DEMO_UPLOADS ?? 'beta';
    if (demoMode !== 'paused' && demoMode !== 'beta')
      throw new Error('RENDER_DEMO_UPLOADS debe ser paused o beta.');
    return demoMode;
  }
  if (
    mode === 'beta' &&
    !['development', 'test'].includes(String(input.NODE_ENV ?? 'development'))
  )
    throw new Error('DOCUMENT_UPLOAD_MODE=beta solo se admite en desarrollo.');
  return mode;
}
