export function productTypeForCategory(category, fallback = "fresco") {
  const normalized = String(category || "").trim().toLocaleLowerCase();
  return ["fresco", "arilos"].includes(normalized) ? normalized : fallback;
}

export function defaultPalletPackageCount(form) {
  if (form.product_type !== "fresco") return null;
  const weight = String(form.package_type || "").match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*kg\b/i);
  if (!weight || Number(weight[1].replace(",", ".")) !== 3.8) return null;
  const size = String(form.calibre || "").trim().match(/^(?:(?:calibre|cal\.)\s*)?(\d+)$/i);
  if (!size) return null;
  const calibre = Number(size[1]);
  if (calibre >= 5 && calibre <= 8) return 240;
  if (calibre >= 10 && calibre <= 14) return 214;
  return null;
}

export function updateNewPalletField(form, key, value) {
  const next = { ...form, [key]: value, ...(key === "category" ? { product_type: productTypeForCategory(value, form.product_type) } : {}) };
  if (!["package_type", "calibre", "product_type", "category"].includes(key)) return next;
  const count = defaultPalletPackageCount(next);
  if (count !== null) return { ...next, package_count: count };
  const previous = defaultPalletPackageCount(form);
  if (previous !== null && Number(form.package_count) === previous) {
    return { ...next, package_count: "" };
  }
  return next;
}
