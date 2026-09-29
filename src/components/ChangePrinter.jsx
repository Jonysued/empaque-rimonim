import React from "react";
import { Button } from "@/components/ui/button";
import { canChoosePrinter, choosePrinter } from "@/lib/catalogs";

export default function ChangePrinter() {
  if (!canChoosePrinter()) return null;

  return (
    <Button type="button" variant="ghost" size="sm" onClick={choosePrinter}>
      Cambiar impresora
    </Button>
  );
}
