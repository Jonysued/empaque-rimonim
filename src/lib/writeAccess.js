import { localSessionIdentity } from '@/api/base44Client';
import { readSnapshot } from '@/lib/offlineStore';
import { currentWorkspace } from '@/lib/workspace';
import { canCorrect, canSubmitCommand } from '@/lib/permissions';

// Auth loads this company-scoped profile before exposing operational screens.
// Use the same cached permissions offline, before persisting any new command.
export async function operationalProfile() {
  const { id } = await localSessionIdentity();
  const company = currentWorkspace()?.id;
  return await readSnapshot(id, company ? `profile:${company}` : 'profile');
}
export async function assertOperationalWrite(rpc = '', params = {}) {
  const profile = await operationalProfile();
  if (!profile || (!canCorrect(profile.role) && !canSubmitCommand(profile.role,rpc,params))) {
    throw new Error(!profile || ['consulta','user'].includes(profile.role)
      ? 'Tu perfil es de solo lectura. No podés crear, modificar ni eliminar datos.'
      : 'Tu perfil solo permite cargar operaciones de su estación. No podés corregir ni eliminar datos confirmados.');
  }
}
