export function companyQrPayload(code, company) {
  const value=String(code || '');
  // Preserve labels readable by already installed Rimonim clients.
  return company && company.slug!=='rimonim' ? `EMPACO|${company.id}|${value}` : value;
}
export function readCompanyQr(value, company, manual=false) {
  const code=String(value || '').trim();
  if(code.startsWith('EMPACO|')) {
    const [,id,...parts]=code.split('|');
    if(id!==company?.id) throw new Error('Este QR pertenece a otra empresa');
    return parts.join('|');
  }
  if(company && company.slug!=='rimonim' && !manual) throw new Error('El QR no identifica esta empresa. Usá sus etiquetas o ingresá el código manualmente.');
  return code;
}
