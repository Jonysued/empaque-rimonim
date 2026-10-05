import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { currentWorkspace } from '@/lib/workspace';
import { companyQrPayload } from '@/lib/companyQr.mjs';

// Generate on-device: cached records must remain scannable without signal.
export default function QRImage({ code, size = 160, className = '' }) {
  const [image, setImage] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setImage(null); setError('');
    QRCode.toDataURL(companyQrPayload(code,currentWorkspace()), { width: size, margin: 2 })
      .then(src => { if (active) setImage({ code, size, src }); })
      .catch(() => { if (active) setError('No se pudo generar el QR'); });
    return () => { active = false; };
  }, [code, size]);
  if (!image || image.code !== code || image.size !== size) return <span role="status" className="text-xs text-muted-foreground">{error || 'Generando QR…'}</span>;
  return <img src={image.src} width={size} height={size} className={`max-w-full h-auto ${className}`} alt={`QR ${code}`} />;
}
