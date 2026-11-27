import { subscribeEvents, getEventHistory } from "@/lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSE para el dashboard y el widget. En Vercel la instancia puede cambiar entre
 * peticiones; la interfaz usa polling como fallback (ver AppShell/inbox).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const visitorId = url.searchParams.get("visitorId");
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`event: connected\ndata: {"at":${Date.now()}}\n\n`));

      for (const item of getEventHistory(5)) {
        controller.enqueue(encoder.encode(`event: ${item.name}\ndata: ${JSON.stringify(item.payload)}\n\n`));
      }

      const unsubscribe = subscribeEvents((name, payload) => {
        try {
          // El widget solo ve eventos de su propio visitante.
          if (visitorId && typeof payload === "object" && payload !== null) {
            const p = payload as Record<string, unknown>;
            if (p.visitorId && p.visitorId !== visitorId) return;
          }
          controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {
          unsubscribe();
        }
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 20_000);

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ya cerrado
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
