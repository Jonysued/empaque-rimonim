import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import QRLabel from "@/components/QRLabel";
import { QrCode } from "lucide-react";

export default function LocationQR({ location }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpen(true)}>
        <QrCode className="w-4 h-4 mr-1" /> QR
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>QR de {location.name}</DialogTitle></DialogHeader>
          <QRLabel code={location.location_code} title={location.name} subtitle="Ubicación fija" />
        </DialogContent>
      </Dialog>
    </>
  );
}