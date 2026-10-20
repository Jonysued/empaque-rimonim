import { localSessionIdentity } from '@/api/base44Client';
import { readSnapshot } from '@/lib/offlineStore';
import { currentWorkspace } from '@/lib/workspace';

// Auth loads this company-scoped profile before exposing operational screens.
// Use the same cached permissions offline, before persisting any new command.
export async function assertOperationalWrite() {
  const { id } = await localSessionIdentity();
  const company = currentWorkspace()?.id;
  const profile = await readSnapshot(id, company ? `profile:${company}` : 'profile');
  if (!profile || !profile.role || ['consulta', 'user'].includes(profile.role)) {
    throw new Error('Tu perfil es de solo lectura. No podés crear, modificar ni eliminar datos.');
  }
}
