import { z } from "zod";

/** Configuración central. Los secretos nunca se exponen al cliente. */
const EnvSchema = z.object({
  DATABASE_URL: z.string().default("postgres://nexo:nexo@localhost:5432/nexo"),
  DIRECT_URL: z.string().default("postgres://nexo:nexo@localhost:5432/nexo"),
  JWT_SECRET: z.string().default("dev-only-change-me"),
  APP_URL: z.string().default("http://localhost:3000"),
  INGEST_TOKEN: z.string().default("dev-ingest-token"),
  CRON_SECRET: z.string().default("dev-cron-secret"),

  OPENROUTER_API_KEY: z.string().default(""),
  OPENROUTER_MODEL: z.string().default("openai/gpt-4o-mini"),
  EMBEDDING_MODEL: z.string().default("openai/text-embedding-3-small"),
  AI_ENABLED: z.string().default("true"),
  AI_MAX_TOKENS: z.coerce.number().default(600),
  AI_PROPOSAL_TTL_MINUTES: z.coerce.number().default(30),
  AI_MONTHLY_BUDGET_USD: z.coerce.number().default(10),

  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(""),
  TELEGRAM_APPROVER_CHAT_IDS: z.string().default(""),

  WHATSAPP_PHONE_NUMBER_ID: z.string().default(""),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().default(""),
  WHATSAPP_ACCESS_TOKEN: z.string().default(""),
  WHATSAPP_VERIFY_TOKEN: z.string().default(""),
  WHATSAPP_API_VERSION: z.string().default("v23.0"),

  INSTAGRAM_APP_ID: z.string().default(""),
  INSTAGRAM_APP_SECRET: z.string().default(""),
  INSTAGRAM_ACCESS_TOKEN: z.string().default(""),
  INSTAGRAM_VERIFY_TOKEN: z.string().default(""),
  INSTAGRAM_API_VERSION: z.string().default("v23.0"),

  EMAIL_IMAP_HOST: z.string().default(""),
  EMAIL_IMAP_PORT: z.coerce.number().default(993),
  EMAIL_IMAP_USER: z.string().default(""),
  EMAIL_IMAP_PASS: z.string().default(""),
  EMAIL_SMTP_HOST: z.string().default(""),
  EMAIL_SMTP_PORT: z.coerce.number().default(587),
  EMAIL_SMTP_USER: z.string().default(""),
  EMAIL_SMTP_PASS: z.string().default(""),
  EMAIL_FROM: z.string().default("Nexo <soporte@tudominio.com>"),

  S3_ENDPOINT: z.string().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("nexo"),
  S3_ACCESS_KEY: z.string().default("nexo"),
  S3_SECRET_KEY: z.string().default("nexo"),
  S3_FORCE_PATH_STYLE: z.string().default("true"),

  OUTBOUND_WEBHOOK_URL: z.string().default(""),
  OUTBOUND_WEBHOOK_SECRET: z.string().default(""),

  SEED_OWNER_PASSWORD: z.string().default("nexo123"),
  NODE_ENV: z.string().default("development"),
  LOG_LEVEL: z.string().default("info"),
});

export const env = EnvSchema.parse(process.env);

export const isProd = env.NODE_ENV === "production";
export const aiEnabled = env.AI_ENABLED === "true" && env.OPENROUTER_API_KEY.length > 0;
export const approverChatIds = env.TELEGRAM_APPROVER_CHAT_IDS.split(",")
  .map((v) => v.trim())
  .filter(Boolean);
