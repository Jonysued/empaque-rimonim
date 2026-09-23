// Generación de QR (imagen) y códigos únicos

// Genera una URL de imagen QR usando api.qrserver.com (sin instalar dependencias)
export function qrImageUrl(data, size = 200) {
  const encoded = encodeURIComponent(data);
  return `https://api.qrserver.com/v1/create-qr-code/?data=${encoded}&size=${size}x${size}&margin=10`;
}

// Genera un código corto legible con prefijo
export function generateCode(prefix = "RIM") {
  const ts = Date.now().toString(36).toUpperCase().slice(-5);
  const rand = Math.random().toString(36).toUpperCase().slice(2, 5);
  return `${prefix}-${ts}${rand}`;
}

export function generateRomaneoNumber(seq = 1) {
  const year = new Date().getFullYear();
  return `ROM-${year}-${String(seq).padStart(5, "0")}`;
}

// Formatea kg
export function fmtKg(v) {
  if (v == null || isNaN(v)) return "0 kg";
  return `${Number(v).toLocaleString("es-AR", { maximumFractionDigits: 1 })} kg`;
}

export function fmtNum(v) {
  if (v == null || isNaN(v)) return "0";
  return Number(v).toLocaleString("es-AR");
}

export function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("es-AR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  } catch { return d; }
}

export function fmtDay(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return d; }
}