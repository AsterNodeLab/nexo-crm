import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  getApproval: vi.fn(),
  decideApproval: vi.fn(),
  createOutboundMessage: vi.fn(),
  getChannelConfig: vi.fn(),
  recordAudit: vi.fn(),
  publishEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { select: mocks.select, update: mocks.update, insert: mocks.insert },
  sql: () => ({}),
}));

vi.mock("@/lib/env", () => ({
  env: {
    TELEGRAM_BOT_TOKEN: "test-bot-token",
    TELEGRAM_WEBHOOK_SECRET: "",
    APP_URL: "http://localhost:3000",
  },
  approverChatIds: ["123"],
  aiEnabled: true,
}));

vi.mock("@/lib/crypto", () => ({
  hashToken: (token: string) => `hash:${token}`,
  safeEqual: (a: string, b: string) => a === b,
}));

vi.mock("@/lib/events", () => ({ publishEvent: mocks.publishEvent }));

vi.mock("@/lib/repository", () => ({
  getApproval: mocks.getApproval,
  decideApproval: mocks.decideApproval,
  createOutboundMessage: mocks.createOutboundMessage,
  getChannelConfig: mocks.getChannelConfig,
  recordAudit: mocks.recordAudit,
}));

import { encodeCallbackData } from "@/lib/channels/support";
import { handleTelegramCallback } from "@/lib/channels/telegram";

/** Las queries de drizzle son thenables; este fake permite responder por llamada. */
function queryWithRows<T>(rows: T[]): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const name of ["from", "where", "limit", "set", "values", "onConflictDoNothing"]) {
    query[name] = () => query;
  }
  query.then = (
    resolve: (value: T[]) => unknown,
    reject?: (error: unknown) => unknown,
  ) => Promise.resolve(rows).then(resolve, reject);
  return query;
}

const approvalId = randomUUID();
const conversationId = randomUUID();
const channelId = randomUUID();
const aiActionId = randomUUID();
const token = randomUUID();

function approval(expiresAt: string) {
  return {
    id: approvalId,
    conversationId,
    channelId,
    recipient: "123",
    aiActionId,
    proposalText: "Sí, podemos agendar la demo.",
    editedText: null,
    status: "pending",
    channel: "telegram",
    citations: [],
    expiresAt,
    createdAt: new Date().toISOString(),
  };
}

function callback(action: "approve" | "reject" | "edit") {
  return {
    id: "callback-1",
    data: encodeCallbackData({ approvalId, action, token }),
    from: { id: 123 },
    message: { chat: { id: 123 }, message_id: 1 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })),
  );
  mocks.getChannelConfig.mockResolvedValue(null);
  mocks.decideApproval.mockResolvedValue(undefined);
  mocks.createOutboundMessage.mockResolvedValue("outbound-1");
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.update.mockImplementation(() => queryWithRows([]));
  // Primera select: hash del token; segunda: aiAction sin mensaje saliente previo.
  mocks.select
    .mockImplementationOnce(() => queryWithRows([{ hash: `hash:${token}` }]))
    .mockImplementationOnce(() => queryWithRows([]));
});

describe("aprobación desde Telegram", () => {
  it("pending + approve decide la aprobación y crea el mensaje saliente", async () => {
    mocks.getApproval.mockResolvedValue(
      approval(new Date(Date.now() + 60_000).toISOString()),
    );

    await handleTelegramCallback(callback("approve"));

    expect(mocks.decideApproval).toHaveBeenCalledWith(approvalId, { status: "approved" });
    expect(mocks.createOutboundMessage).toHaveBeenCalledWith({
      conversationId,
      channelId,
      recipient: "123",
      body: "Sí, podemos agendar la demo.",
      authorType: "ai",
      status: "queued",
      aiActionId,
    });
  });

  it("una aprobación expirada no se decide ni genera envío", async () => {
    mocks.getApproval.mockResolvedValue(
      approval(new Date(Date.now() - 60_000).toISOString()),
    );

    await handleTelegramCallback(callback("approve"));

    expect(mocks.decideApproval).not.toHaveBeenCalled();
    expect(mocks.createOutboundMessage).not.toHaveBeenCalled();
  });

  it("un token distinto al de la BD no autoriza la decisión", async () => {
    mocks.getApproval.mockResolvedValue(
      approval(new Date(Date.now() + 60_000).toISOString()),
    );
    mocks.select
      .mockReset()
      .mockImplementationOnce(() => queryWithRows([{ hash: `hash:${randomUUID()}` }]));

    await handleTelegramCallback(callback("approve"));

    expect(mocks.decideApproval).not.toHaveBeenCalled();
    expect(mocks.createOutboundMessage).not.toHaveBeenCalled();
  });
});
