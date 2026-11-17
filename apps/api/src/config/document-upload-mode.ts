export function documentUploadMode(input: Record<string, unknown>) {
  const mode = input.DOCUMENT_UPLOAD_MODE ?? 'paused';
  if (mode !== 'paused' && mode !== 'verified')
    throw new Error('DOCUMENT_UPLOAD_MODE debe ser paused o verified.');
  return mode;
}
