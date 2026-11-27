import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  publishEvent: vi.fn(),
  proposeReply: vi.fn(),
}));

function queryWithRows<T>(rows: T[]): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const name of ["from", "where", "orderBy", "limit", "set", "values", "onConflictDoNothing"]) {
    query[name] = () => query;
  }
  query.then = (
    resolve: (value: T[]) => unknown,
    reject?: (error: unknown) => unknown,
  ) => Promise.resolve(rows).then(resolve, reject);
  return query;
}

vi.mock("@/lib/db", () => ({
  db: { select: mocks.select, update: mocks.update, insert: mocks.insert },
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

vi.mock("@/lib/events", () => ({ publishEvent: mocks.publishEvent }));
vi.mock("@/lib/ai", () => ({ proposeReply: mocks.proposeReply }));

import { evaluateRules, matchesConditions, ruleInternals } from "@/lib/rules";

const event = {
  type: "message.created",
  aggregateType: "conversation",
  aggregateId: "11111111-1111-1111-1111-111111111111",
  payload: { text: "Necesito una factura", channel: "web", status: "open" },
};

describe("condiciones de reglas", () => {
  it("equals compara el valor del payload", () => {
    expect(matchesConditions({ channel: "web" }, event.payload)).toBe(true);
    expect(matchesConditions({ channel: "telegram" }, event.payload)).toBe(false);
  });

  it("contains busca dentro de strings y arrays", () => {
    expect(matchesConditions({ text: { operator: "contains", value: "factura" } }, event.payload)).toBe(true);
    expect(
      ruleInternals.normalizeActions([{ type: "add_label", value: "facturacion" }]),
    ).toEqual([{ type: "add_label", value: "facturacion" }]);
    expect(
      matchesConditions({ tags: { operator: "contains", value: "urgente" } }, { tags: ["urgente", "web"] }),
    ).toBe(true);
  });

  it("in y exists funcionan con valores ausentes", () => {
    expect(matchesConditions({ status: { operator: "in", value: ["open", "pending"] } }, event.payload)).toBe(true);
    expect(matchesConditions({ missing: { operator: "exists", value: false } }, event.payload)).toBe(true);
    expect(matchesConditions({ status: { operator: "exists" } }, event.payload)).toBe(true);
  });
});

describe("evaluateRules", () => {
  it("traga errores de carga sin lanzar", async () => {
    mocks.select.mockImplementation(() => {
      throw new Error("DB_DOWN");
    });
    await expect(evaluateRules(event)).resolves.toBeUndefined();
  });

  it("publica rule.failed cuando una acción falla, sin romper la ingesta", async () => {
    const rule = {
      id: "22222222-2222-2222-2222-222222222222",
      active: true,
      conditions: { channel: "web" },
      actions: [{ type: "reply_with_ai" }],
      priority: 0,
    };
    mocks.select.mockReset();
    // loadRules pide primero el workspace y después las reglas.
    mocks.select.mockImplementationOnce(() => queryWithRows([{ id: "workspace-1" }]));
    mocks.select.mockImplementationOnce(() => queryWithRows([rule]));
    mocks.select.mockImplementation(() => queryWithRows([]));
    mocks.insert.mockImplementation(() => queryWithRows([]));
    mocks.proposeReply.mockRejectedValue(new Error("AI_DOWN"));

    await expect(evaluateRules(event)).resolves.toBeUndefined();
    expect(mocks.proposeReply).toHaveBeenCalledWith(event.aggregateId);
    expect(mocks.publishEvent).toHaveBeenCalledWith(
      "rule.failed",
      expect.objectContaining({ error: "AI_DOWN", ruleId: rule.id }),
    );
  });
});
