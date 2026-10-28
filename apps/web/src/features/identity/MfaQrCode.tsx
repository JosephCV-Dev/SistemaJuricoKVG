const allowedElements = new Set(['svg', 'g', 'path', 'rect', 'circle']);
const allowedAttributes = new Set([
  'xmlns',
  'viewBox',
  'width',
  'height',
  'x',
  'y',
  'cx',
  'cy',
  'r',
  'd',
  'fill',
  'stroke',
  'stroke-width',
  'shape-rendering',
  'transform',
]);

function safeQrSource(value: string): string | null {
  if (value.length > 200_000) return null;

  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) {
    return value;
  }

  let svg = value.trim();

  try {
    if (svg.startsWith('data:image/svg+xml;base64,')) {
      svg = atob(svg.slice('data:image/svg+xml;base64,'.length));
    } else if (/^data:image\/svg\+xml;(?:charset=utf-8|utf8),/i.test(svg)) {
      svg = decodeURIComponent(svg.slice(svg.indexOf(',') + 1));
    } else if (svg.startsWith('data:image/svg+xml,')) {
      svg = decodeURIComponent(svg.slice('data:image/svg+xml,'.length));
    }

    if (/<!(?:DOCTYPE|ENTITY)/i.test(svg)) return null;

    const document = new DOMParser().parseFromString(svg, 'image/svg+xml');

    if (
      document.querySelector('parsererror') ||
      document.documentElement.localName !== 'svg'
    ) {
      return null;
    }

    for (const element of document.querySelectorAll('*')) {
      if (
        !allowedElements.has(element.localName) ||
        element.namespaceURI !== 'http://www.w3.org/2000/svg'
      ) {
        return null;
      }

      for (const attribute of element.attributes) {
        if (!allowedAttributes.has(attribute.name)) return null;
        if (attribute.name === 'xmlns') {
          if (attribute.value !== 'http://www.w3.org/2000/svg') return null;
        } else if (
          /(?:url\s*\(|javascript:|data:|https?:)/i.test(attribute.value)
        ) {
          return null;
        }
      }
    }

    return `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(document.documentElement))}`;
  } catch {
    return null;
  }
}

export function MfaQrCode({ qrCode }: { qrCode: string }) {
  const source = safeQrSource(qrCode);

  return source ? (
    <img
      src={source}
      alt="Código QR para configurar tu aplicación de autenticación"
    />
  ) : (
    <p>
      Utiliza la clave manual para configurar tu aplicación de autenticación.
    </p>
  );
}
