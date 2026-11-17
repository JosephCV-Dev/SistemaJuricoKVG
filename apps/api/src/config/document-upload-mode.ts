export function documentUploadMode(input: Record<string, unknown>) {
  const mode = input.DOCUMENT_UPLOAD_MODE ?? 'paused';
  if (mode !== 'paused' && mode !== 'verified' && mode !== 'beta')
    throw new Error('DOCUMENT_UPLOAD_MODE debe ser paused, verified o beta.');
  if (
    mode === 'beta' &&
    !['development', 'test'].includes(String(input.NODE_ENV ?? 'development'))
  )
    throw new Error('DOCUMENT_UPLOAD_MODE=beta solo se admite en desarrollo.');
  return mode;
}
