import { Hono } from "hono";
import { z } from "zod";
import { scanAllConfigs } from "../config/scanner.js";
import { parseJsonMcpConfig } from "../config/import-parser.js";
import { generateSnippets } from "../config/snippets.js";
import { getClientById } from "../config/clients.js";
import { convertConfig, type ConvertInput } from "../config/converter.js";
import { serverManager } from "../services/server-manager.js";
import { profileService } from "../services/profiles.js";
import {
  getExistingNames,
  selectImportCandidates,
  buildImportPreview,
  findServerIdByName,
} from "../services/import-service.js";
import { isRecord } from "../utils.js";
import type { ScannedServer } from "@moor/types";

export { selectImportCandidates };

const importApi = new Hono();

const MAX_PARSE_BODY_BYTES = 512 * 1024; // 512 KB
const MAX_CONVERT_SERVER_IDS = 200;

const clientIdSchema = z.string().refine((id) => Boolean(getClientById(id)), {
  message: "unknown client id",
});

const convertInputSchema = z
  .object({
    source: z.enum(["moor", "scan", "paste"]),
    sourceClient: clientIdSchema.optional(),
    content: z.string().max(MAX_PARSE_BODY_BYTES).optional(),
    serverIds: z.array(z.string()).max(MAX_CONVERT_SERVER_IDS).optional(),
    targetClient: clientIdSchema,
  })
  .strict();

function formatValidationError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "invalid request";
  const field = issue.path.join(".") || "request";
  return `${field}: ${issue.message}`;
}

importApi.post("/scan", (c) => {
  const parsed = scanAllConfigs();
  const preview = buildImportPreview(parsed, getExistingNames());
  return c.json(preview);
});

importApi.post("/parse", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { content?: string };
  if (!body.content?.trim()) {
    return c.json({ error: "content is required" }, 400);
  }
  if (body.content.length > MAX_PARSE_BODY_BYTES) {
    return c.json({ error: "content exceeds maximum allowed size" }, 413);
  }

  const parsed = parseJsonMcpConfig(body.content, "json-import");
  return c.json(buildImportPreview(parsed, getExistingNames()));
});

importApi.post("/execute", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { servers?: ScannedServer[] };
  const existingNames = getExistingNames();
  const servers = body.servers?.length
    ? selectImportCandidates(body.servers, existingNames)
    : selectImportCandidates(scanAllConfigs().servers, existingNames);
  const imported: string[] = [];
  const skipped: string[] = [];

  for (const serverConfig of servers) {
    if (findServerIdByName(serverConfig.name)) {
      skipped.push(serverConfig.name);
      continue;
    }

    serverManager.addServer({
      name: serverConfig.name,
      connectionType: serverConfig.connectionType,
      command: serverConfig.command,
      args: serverConfig.args,
      url: serverConfig.url,
      env: serverConfig.env,
      headers: serverConfig.headers,
      workingDir: serverConfig.workingDir,
    });
    imported.push(serverConfig.name);
  }

  if (imported.length > 0) {
    const serverIds = imported.map((name) => findServerIdByName(name)).filter(Boolean) as string[];
    profileService.assignToActiveProfile(serverIds);
  }

  return c.json({ imported, skipped });
});

importApi.get("/snippets", (c) => {
  const url = new URL(c.req.url);
  return c.json(generateSnippets(`${url.protocol}//${url.host}/mcp`));
});

importApi.post("/convert", async (c) => {
  const rawBody = (await c.req.json().catch(() => null)) as unknown;

  if (!isRecord(rawBody)) {
    return c.json({ error: "request body must be a JSON object" }, 400);
  }

  if (typeof rawBody.content === "string" && rawBody.content.length > MAX_PARSE_BODY_BYTES) {
    return c.json({ error: "content exceeds maximum allowed size" }, 413);
  }

  const parsedBody = convertInputSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return c.json({ error: formatValidationError(parsedBody.error) }, 400);
  }

  try {
    const body: ConvertInput = parsedBody.data;
    const result = convertConfig({
      source: body.source,
      sourceClient: body.sourceClient,
      content: body.content,
      serverIds: body.serverIds,
      targetClient: body.targetClient,
    });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Conversion failed";
    return c.json({ error: message }, 422);
  }
});

export { importApi };
