import { useCallback, useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { getOperations, submitOperation } from '@/lib/operationQueue';
import { projectFieldOperations } from '@/lib/fieldWorkflow.mjs';

export function useFieldLots() {
  const [state, setState] = useState({ lots: [], bins: [], loading: true, error: '' });
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const [lots, bins, operations] = await Promise.all([
        base44.entities.ReceiptLot.list(), base44.entities.Bin.list(), getOperations(),
      ]);
      if (request === sequence.current) setState({ ...projectFieldOperations(lots, bins, operations), loading: false, error: '' });
    } catch (error) {
      if (request === sequence.current) setState(current => ({ ...current, loading: false, error: error.message || 'No se pudieron cargar los lotes' }));
    }
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener('rimonim-queue-change', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      sequence.current++;
      window.removeEventListener('rimonim-queue-change', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);
  return { ...state, refresh };
}

export function fieldOperation(lotId, action, params = {}, operationId = crypto.randomUUID()) {
  return submitOperation('field_lot_operation', { p_lot_id: lotId, p_action: action, ...params },
    `field:${lotId}:${action}:${params.p_bin_code || 'stage'}`, operationId);
}

export function harvestOperation(binId, record, operationId = crypto.randomUUID()) {
  return submitOperation('harvest_bin_operation', { p_bin_id: binId, p_record: record },
    `harvest:${record.bin_code}`, operationId);
}
