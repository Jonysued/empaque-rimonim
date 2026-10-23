import React, { useState } from 'react';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

/** Keep reference information available without pushing mobile records below the fold. */
export default function PageInfo({ title = 'Información', children }) {
  const [open, setOpen] = useState(false);
  return <>
    <div className="hidden md:block text-sm text-muted-foreground">{children}</div>
    <Button type="button" variant="ghost" className="md:hidden px-0 text-muted-foreground" onClick={() => setOpen(true)}><Info className="h-4 w-4"/> {title}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Información sobre esta sección.</DialogDescription></DialogHeader><div className="space-y-3 text-sm text-muted-foreground">{children}</div></DialogContent></Dialog>
  </>;
}
