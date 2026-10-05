import assert from "node:assert/strict";
import { defaultPalletPackageCount, updateNewPalletField } from "../src/lib/palletPackageCount.mjs";

const form = { product_type: "fresco", package_type: "Caja 3,8 kg", calibre: "", package_count: "" };
for (const calibre of [5, 6, 7, 8]) {
  assert.equal(defaultPalletPackageCount({ ...form, calibre: `Calibre ${calibre}` }), 240);
}
for (const calibre of [10, 11, 12, 13, 14]) {
  assert.equal(defaultPalletPackageCount({ ...form, calibre: `Calibre ${calibre}` }), 214);
}
for (const calibre of [4, 9, 15, 18]) {
  assert.equal(defaultPalletPackageCount({ ...form, calibre: `Calibre ${calibre}` }), null);
}
assert.equal(defaultPalletPackageCount({ ...form, package_type: "Caja 3.8kg", calibre: "Cal. 8" }), 240);
for (const package_type of ["Caja 10 kg", "Caja 13,8 kg", ""]) {
  assert.equal(defaultPalletPackageCount({ ...form, package_type, calibre: "Calibre 8" }), null);
}
assert.equal(defaultPalletPackageCount({ ...form, product_type: "otro", calibre: "Calibre 8" }), null);
let selected = updateNewPalletField(form, "calibre", "Calibre 8");
assert.equal(selected.package_count, 240);
selected = updateNewPalletField(selected, "calibre", "Calibre 12");
assert.equal(selected.package_count, 214);
assert.equal(updateNewPalletField(selected, "calibre", "Calibre 9").package_count, "");
assert.equal(updateNewPalletField(selected, "package_type", "Caja 10 kg").package_count, "");
assert.equal(updateNewPalletField(selected, "product_type", "otro").package_count, "");
assert.equal(updateNewPalletField({ ...form, package_type: "", calibre: "Calibre 5" }, "package_type", "Caja 3,8 kg").package_count, 240);
assert.equal(updateNewPalletField({ ...selected, package_count: 200 }, "package_type", "Caja 10 kg").package_count, 200);
assert.equal(updateNewPalletField(selected, "package_count", "200").package_count, "200");
console.log("Pallet package counts: OK");

const arilos = updateNewPalletField(selected, "category", "Arilos");
assert.equal(arilos.product_type, "arilos");
assert.equal(arilos.package_count, "");
const fresco = updateNewPalletField(arilos, "category", "Fresco");
assert.equal(fresco.product_type, "fresco");
assert.equal(fresco.package_count, 214);
