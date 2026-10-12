// Coalesce queue bursts and never overlap automatic refreshes. An event received
// during a read schedules one more read so the last confirmed change is included.
/**
 * @param {() => Promise<unknown> | unknown} refresh
 * @param {{intervalMs?: number, onTick?: () => void, canPoll?: () => boolean,
 * windowTarget?: Window, documentTarget?: Document}} options
 */
export function subscribeOperationalRefresh(refresh, {
  intervalMs = 0, onTick = () => {}, canPoll = () => true,
  windowTarget = window, documentTarget = document,
} = {}) {
  let stopped = false, running = false, requested = false, timer;
  const visible = () => documentTarget.visibilityState !== 'hidden';
  const run = async () => {
    timer = undefined;
    if (stopped || !visible() || running || !requested) return;
    requested = false; running = true;
    try { await refresh(); }
    catch (error) { console.error('No se pudo refrescar la pantalla', error); }
    finally {
      running = false;
      if (!stopped && requested && visible()) schedule();
    }
  };
  function schedule() {
    if (stopped) return;
    requested = true;
    if (timer !== undefined || running || !visible()) return;
    timer = setTimeout(run, 150);
  }
  const resume = () => { if (visible()) schedule(); };
  const events = ['rimonim-queue-change', 'focus', 'online', 'offline'];
  for (const event of events) windowTarget.addEventListener(event, schedule);
  documentTarget.addEventListener('visibilitychange', resume);
  const interval = intervalMs ? setInterval(() => {
    if (!visible()) return;
    onTick();
    if (canPoll()) schedule();
  }, intervalMs) : undefined;
  requested = true;
  void run();
  return () => {
    stopped = true;
    clearTimeout(timer); clearInterval(interval);
    for (const event of events) windowTarget.removeEventListener(event, schedule);
    documentTarget.removeEventListener('visibilitychange', resume);
  };
}
