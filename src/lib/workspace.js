// The selected company is sent with every database request. The server always
// verifies membership; this local value never grants access.
let workspace = null;
let owner = null;
export const canManageWorkspaces = user => user?.email?.trim().toLowerCase() === 'jonatan@rimonim.com.ar';
export const currentWorkspace = () => workspace;
export function setWorkspace(userId, value) { owner = userId; workspace = value; }
export function clearWorkspace() { owner = null; workspace = null; }
export function workspaceOwner(userId) {
  if (!workspace || owner !== userId) throw new Error('Conectate para seleccionar tu empresa');
  return `${userId}::${workspace.id}`;
}
export function selectedWorkspace(userId) {
  return sessionStorage.getItem(`empaco-workspace:${userId}`) || localStorage.getItem(`empaco-workspace:${userId}`);
}
export function rememberWorkspace(userId,id) { sessionStorage.setItem(`empaco-workspace:${userId}`,id); }
export function selectWorkspace(userId, id) {
  rememberWorkspace(userId,id);
  localStorage.setItem(`empaco-workspace:${userId}`, id);
  // Full reload discards component state and in-memory query results.
  window.location.assign('/');
}
export function workspaceHeaders(init = {}) {
  const headers = new Headers(init.headers);
  if (workspace) headers.set('x-empaco-company', workspace.id);
  return { ...init, headers };
}
