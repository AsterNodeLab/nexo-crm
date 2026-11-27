/**
 * Bus de eventos en memoria para SSE.
 *
 * IMPORTANTE: en serverless este bus vive por instancia, así que un evento publicado
 * en una función no llega a las demás. La UI debe usar polling como fallback:
 * subscribeEvents() da latencia baja cuando coincide la instancia, y el endpoint
 * de historial/estado garantiza consistencia eventual.
 */
type EventListener = (name: string, payload: unknown) => void;
type HistoryEntry = { name: string; payload: unknown; at: string };

const listeners = new Set<EventListener>();
const HISTORY_SIZE = 200;
const history: HistoryEntry[] = [];

export function publishEvent(name: string, payload: unknown): void {
  history.push({ name, payload, at: new Date().toISOString() });
  if (history.length > HISTORY_SIZE) history.splice(0, history.length - HISTORY_SIZE);
  for (const listener of listeners) {
    // Un listener roto no debe impedir que se entregue el evento a los demás.
    try {
      listener(name, payload);
    } catch {
      // Silencioso a propósito: no loguear payloads que puedan contener datos de clientes.
    }
  }
}

/** Suscribe un listener y devuelve la función para darse de baja. */
export function subscribeEvents(listener: EventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Últimos eventos, más recientes primero, limitados a `limit`. */
export function getEventHistory(limit = 50): HistoryEntry[] {
  const safeLimit = Math.max(0, Math.min(Math.trunc(limit), HISTORY_SIZE));
  return history.slice(-safeLimit).reverse();
}
