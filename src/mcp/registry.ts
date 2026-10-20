/**
 * MCP Registry — Static Tool, Resource, and Prompt Registration
 *
 * Registers exactly the v1 MCP surface on a low-level SDK Server:
 *   Tools:     search_items, get_item, list_facets, find_related_items, explain_search
 *   Resources: jhu-repo://jscholarship/item/{encodedIdentifier}
 *              jhu-repo://jhrdr/dataset/{encodedIdentifier}
 *   Prompts:   explore_research_topic, find_reusable_data
 *
 * The low-level handlers give the closed schemas real protocol force:
 * arguments are parsed with the strict zod schemas (unknown properties are
 * REJECTED, not stripped) before any handler runs, tools/list advertises the
 * generated JSON Schemas with additionalProperties: false, every tool carries
 * a read-only annotation, and successful results return structuredContent
 * plus a compact text rendering and resource links. No dynamic tool creation;
 * no write, admin, identity, download, HTTP-fetch, database, or
 * code-execution capability exists.
 *
 * Requirements: 1.7, 4.7, 8.4, 12.3-12.5, 17
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListPromptsResultSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  ExplainSearchOutput,
  FindRelatedItemsOutput,
  ItemDetail,
  ListFacetsOutput,
  RepositoryRecord,
  SearchItemsOutput,
} from "../models/index";
import {
  explainSearchInputSchema,
  explainSearchOutputSchema,
  findRelatedItemsInputSchema,
  findRelatedItemsOutputSchema,
  getItemInputSchema,
  getItemOutputSchema,
  listFacetsInputSchema,
  listFacetsOutputSchema,
  searchItemsInputSchema,
  searchItemsOutputSchema,
} from "../models/index";
import {
  type ToolInvocationLog,
  createLogger,
  emitToolMetrics,
  generateRequestId,
} from "../observability/index";
import type { Semaphore } from "../security/index";
import { ToolFailure } from "./errors";
import { SERVER_INSTRUCTIONS } from "./instructions";
import {
  EXPLORE_RESEARCH_TOPIC,
  FIND_REUSABLE_DATA,
  buildExploreResearchTopicMessages,
  buildFindReusableDataMessages,
} from "./prompts";
import {
  JHRDR_DATASET_TEMPLATE,
  JSCHOLARSHIP_ITEM_TEMPLATE,
  readRepositoryResource,
  resourceUriFor,
} from "./resources";
import { explainSearch } from "./tools/explain-search";
import { findRelatedItems } from "./tools/find-related-items";
import { getItem } from "./tools/get-item";
import { listFacets } from "./tools/list-facets";
import { type ToolContext, searchItems } from "./tools/search-items";

export interface RepositoryServerOptions {
  name: string;
  version: string;
  context: ToolContext;
  /** Shared per-task tool-concurrency semaphore (task 17.3). */
  toolSemaphore?: Semaphore;
  /** Correlation ID from the edge middleware. */
  requestId?: string;
  /** Observer for tool-invocation events; defaults to log + EMF emission. */
  observer?: (event: ToolInvocationLog) => void;
}

// ─── Compact text renderings (Requirements 1.7, 4.7) ────────────────────────

function recordLine(index: number, record: RepositoryRecord): string {
  const creators = record.creators.map((c) => c.name).join("; ");
  const date = record.date.display ?? "n.d.";
  const pid = record.persistentId?.url ?? record.landingPageUrl;
  return `${index + 1}. ${record.title} — ${creators || "Unknown"} (${date}) [${record.repository}] ${pid}`;
}

function searchText(output: SearchItemsOutput): string {
  if (output.results.length === 0) {
    return "No matching public records were found. Try broader terms or different filters.";
  }
  const lines = output.results.map((record, i) => recordLine(i, record));
  const partial =
    output.repositories.failed.length > 0
      ? `\nNote: ${output.repositories.failed.join(", ")} was unavailable; results are partial.`
      : "";
  const more = output.cursor === null ? "" : "\nMore results are available via the cursor.";
  return `${lines.join("\n")}${partial}${more}`;
}

function itemText(item: ItemDetail): string {
  const creators = item.creators.map((c) => c.name).join("; ") || "Unknown";
  const pid = item.persistentId?.url ?? item.landingPageUrl;
  if (item.filesStatus === "unavailable") {
    // Written for the researcher, not the operator: no status names or codes.
    return [
      `${item.title}`,
      `Creators: ${creators}`,
      `Date: ${item.date.display ?? "n.d."} | Repository: ${item.repository}`,
      FILES_UNAVAILABLE_NOTE,
      `Cite: ${item.citation ?? pid}`,
      `Link: ${pid}`,
      ...metadataText(item),
    ].join("\n");
  }
  return [
    `${item.title}`,
    `Creators: ${creators}`,
    `Date: ${item.date.display ?? "n.d."} | Repository: ${item.repository} | Access: ${item.access.status}`,
    `Public files: ${item.fileCount}${item.formats.length > 0 ? ` (${item.formats.join(", ")})` : ""}`,
    `Cite: ${item.citation ?? pid}`,
    `Link: ${pid}`,
    ...metadataText(item),
  ].join("\n");
}

/** Shown in place of the file summary when the file list could not be loaded. */
export const FILES_UNAVAILABLE_NOTE =
  "Files: The list of files for this item couldn't be loaded right now. The details below are complete. To see or download the files, open the item page at the link below, or try again in a few minutes.";

/**
 * Values the summary lines above Details already show: title, creators,
 * date, citation, and links. A Details field whose every value is among
 * these is skipped in text so nothing is said twice; structuredContent
 * keeps it. Compared by value, so no platform field names are needed here.
 */
function summaryValues(item: ItemDetail): Set<string> {
  return new Set(
    [
      item.title,
      ...item.creators.map((creator) => creator.name),
      item.date.value,
      item.date.display,
      item.citation,
      item.landingPageUrl,
      item.persistentId?.url,
    ]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map(normalizeForCompare),
  );
}

function normalizeForCompare(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Per-value and overall bounds for the metadata section of the text block. */
const MAX_TEXT_METADATA_VALUE = 1_000;
const MAX_TEXT_METADATA_CHARS = 20_000;

/**
 * The full metadata as `Label: value | value` lines under a "Details" heading,
 * bounded so the text block stays usable; the complete set, with the
 * platform field names, is always in structuredContent.
 */
function metadataText(item: ItemDetail): string[] {
  if (item.metadata.length === 0) {
    return [];
  }
  const repeated = summaryValues(item);
  const shown = item.metadata.filter(
    ({ values }) => !values.every((value) => repeated.has(normalizeForCompare(value))),
  );
  if (shown.length === 0) {
    return [];
  }
  const lines = ["Details:"];
  let used = 0;
  for (const [index, { label, values }] of shown.entries()) {
    const rendered = values
      .map((value) =>
        value.length > MAX_TEXT_METADATA_VALUE
          ? `${value.slice(0, MAX_TEXT_METADATA_VALUE)}…`
          : value,
      )
      .join(" | ")
      .replace(/\s+/g, " ");
    const line = `  ${label}: ${rendered}`;
    if (used + line.length > MAX_TEXT_METADATA_CHARS) {
      lines.push(`  … ${shown.length - index} more field(s) in the structured result.`);
      break;
    }
    lines.push(line);
    used += line.length;
  }
  return lines;
}

function facetsText(output: ListFacetsOutput): string {
  const lines = output.facets.map((facet) => {
    const values = facet.values
      .slice(0, 5)
      .map((v) => `${v.label} (${v.count})`)
      .join(", ");
    return `${facet.facet}: ${values || "no values"}`;
  });
  return lines.join("\n") || "No facets available.";
}

function relatedText(output: FindRelatedItemsOutput): string {
  if (output.results.length === 0) {
    return `No related public records were found for "${output.source.title ?? output.source.identifier}".`;
  }
  const lines = output.results.map((record, i) => recordLine(i, record));
  return `Related to "${output.source.title ?? output.source.identifier}":\n${lines.join("\n")}`;
}

function explainText(output: ExplainSearchOutput): string {
  return output.interpretation;
}

function resourceLinks(records: readonly RepositoryRecord[]): unknown[] {
  return records.map((record) => ({
    type: "resource_link",
    uri: resourceUriFor(record.repository, record.provenance.platformRecordId),
    name: record.title,
    description: `${record.repository} record`,
    mimeType: "application/json",
  }));
}

// ─── Tool table (closed, static — Requirement 17) ───────────────────────────

interface ToolDefinition {
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  run: (
    context: ToolContext,
    args: unknown,
  ) => Promise<{ structured: Record<string, unknown>; text: string; links: unknown[] }>;
}

const TOOLS: Record<string, ToolDefinition> = {
  search_items: {
    description:
      "Search JScholarship (publications) and/or JHRDR (research datasets) with structured filters and cursor pagination. Returns citation-ready public records only.",
    inputSchema: searchItemsInputSchema,
    outputSchema: searchItemsOutputSchema,
    run: async (context, args) => {
      const output = await searchItems(context, searchItemsInputSchema.parse(args));
      return {
        structured: output as unknown as Record<string, unknown>,
        text: searchText(output),
        links: resourceLinks(output.results),
      };
    },
  },
  get_item: {
    description:
      "Resolve one public record by namespaced ID, UUID, Handle, DOI, or Dataverse persistent identifier, with full canonical metadata and public file summaries.",
    inputSchema: getItemInputSchema,
    outputSchema: getItemOutputSchema,
    run: async (context, args) => {
      const output = await getItem(context, getItemInputSchema.parse(args));
      return {
        structured: output as unknown as Record<string, unknown>,
        text: itemText(output),
        links: resourceLinks([output]),
      };
    },
  },
  list_facets: {
    description:
      "List approved facets (repository, creator, subject, year, resourceType, collection) with per-repository counts for refining a search.",
    inputSchema: listFacetsInputSchema,
    outputSchema: listFacetsOutputSchema,
    run: async (context, args) => {
      const output = await listFacets(context, listFacetsInputSchema.parse(args));
      return {
        structured: output as unknown as Record<string, unknown>,
        text: facetsText(output),
        links: [],
      };
    },
  },
  find_related_items: {
    description:
      "Find public records related to a known publication or dataset, within or across the two repositories.",
    inputSchema: findRelatedItemsInputSchema,
    outputSchema: findRelatedItemsOutputSchema,
    run: async (context, args) => {
      const output = await findRelatedItems(context, findRelatedItemsInputSchema.parse(args));
      return {
        structured: output as unknown as Record<string, unknown>,
        text: relatedText(output),
        links: resourceLinks(output.results),
      };
    },
  },
  explain_search: {
    description:
      "Explain how a search would be interpreted per repository (concepts searched, filters applied or unsupported, sort) without executing it.",
    inputSchema: explainSearchInputSchema,
    outputSchema: explainSearchOutputSchema,
    run: async (context, args) => {
      const output = explainSearch(context, explainSearchInputSchema.parse(args));
      return {
        structured: output as unknown as Record<string, unknown>,
        text: explainText(output),
        links: [],
      };
    },
  },
};

function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<string, unknown>;
}

function isZodError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { name?: unknown }).name === "ZodError"
  );
}

// ─── Server factory ──────────────────────────────────────────────────────────

/**
 * Create a fully wired low-level MCP Server for one request. Stateless: the
 * caller creates a fresh instance per POST and connects it to a fresh
 * transport.
 */
export function createRepositoryServer(options: RepositoryServerOptions): Server {
  const { name, version, context } = options;
  const server = new Server(
    { name, version },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      // Reaches every session at initialize, unlike the opt-in prompts.
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(TOOLS).map(([toolName, tool]) => ({
      name: toolName,
      description: tool.description,
      inputSchema: toJsonSchema(tool.inputSchema),
      outputSchema: toJsonSchema(tool.outputSchema),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    })),
  }));

  const defaultLogger = createLogger();
  const observe =
    options.observer ??
    ((event: ToolInvocationLog) => {
      defaultLogger.toolInvocation(event);
      emitToolMetrics(event);
    });

  const emitEvent = (
    tool: string,
    startedAt: number,
    outcome: ToolInvocationLog["outcome"],
    structured?: Record<string, unknown>,
  ): void => {
    const repositories = structured?.repositories as
      | { requested?: string[]; succeeded?: string[]; failed?: string[] }
      | undefined;
    const failed = repositories?.failed ?? [];
    const backendStatus: ToolInvocationLog["backendStatus"] = {};
    for (const repo of repositories?.succeeded ?? []) {
      backendStatus[repo as keyof ToolInvocationLog["backendStatus"]] = "ok";
    }
    for (const repo of failed) {
      backendStatus[repo as keyof ToolInvocationLog["backendStatus"]] = "error";
    }
    const results = structured?.results;
    const clientInfo = server.getClientVersion();
    observe({
      timestamp: new Date().toISOString(),
      requestId: options.requestId ?? generateRequestId(),
      client: clientInfo
        ? { name: String(clientInfo.name), version: String(clientInfo.version) }
        : undefined,
      tool,
      repositories: (repositories?.requested ?? []) as ToolInvocationLog["repositories"],
      latencyMs: Date.now() - startedAt,
      resultCount: Array.isArray(results)
        ? results.length
        : typeof structured?.count === "number"
          ? (structured.count as number)
          : structured !== undefined
            ? 1
            : 0,
      partial: failed.length > 0,
      cache: "bypass",
      backendStatus,
      outcome: failed.length > 0 && outcome === "success" ? "partial" : outcome,
      build: options.version,
    });
  };

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS[request.params.name];
    if (tool === undefined) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }
    const startedAt = Date.now();
    const semaphore = options.toolSemaphore;
    if (semaphore !== undefined && !semaphore.tryAcquire()) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "rate_limited: The server is at its concurrency limit. Retry shortly.",
          },
        ],
      };
    }
    try {
      const { structured, text, links } = await tool.run(context, request.params.arguments ?? {});
      emitEvent(request.params.name, startedAt, "success", structured);
      return {
        content: [{ type: "text", text }, ...(links as never[])],
        structuredContent: structured,
      };
    } catch (error) {
      if (error instanceof ToolFailure) {
        emitEvent(request.params.name, startedAt, "error");
        return {
          isError: true,
          content: [{ type: "text", text: `${error.toolError.code}: ${error.toolError.message}` }],
        };
      }
      if (isZodError(error)) {
        emitEvent(request.params.name, startedAt, "error");
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "invalid_input: The request contains unknown or out-of-bounds properties.",
            },
          ],
        };
      }
      // Unexpected faults never leak internals (Requirement 15.3).
      emitEvent(request.params.name, startedAt, "error");
      return {
        isError: true,
        content: [
          { type: "text", text: "backend_unavailable: The request could not be completed." },
        ],
      };
    } finally {
      semaphore?.release();
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [
      {
        uriTemplate: JSCHOLARSHIP_ITEM_TEMPLATE,
        name: "JScholarship item",
        description: "Canonical public JScholarship record by encoded identifier",
        mimeType: "application/json",
      },
      {
        uriTemplate: JHRDR_DATASET_TEMPLATE,
        name: "JHRDR dataset",
        description: "Canonical public JHRDR dataset by encoded identifier",
        mimeType: "application/json",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
      const item = await readRepositoryResource(context, request.params.uri);
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(item),
          },
        ],
      };
    } catch (error) {
      if (error instanceof ToolFailure) {
        throw new McpError(ErrorCode.InvalidParams, error.toolError.message);
      }
      throw new McpError(ErrorCode.InvalidParams, "The resource could not be read.");
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [EXPLORE_RESEARCH_TOPIC, FIND_REUSABLE_DATA],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    if (request.params.name === EXPLORE_RESEARCH_TOPIC.name) {
      const topic = args.topic;
      if (typeof topic !== "string" || topic.length === 0 || topic.length > 2000) {
        throw new McpError(ErrorCode.InvalidParams, "A topic argument (1-2000 chars) is required.");
      }
      return {
        description: EXPLORE_RESEARCH_TOPIC.description,
        messages: buildExploreResearchTopicMessages(topic),
      };
    }
    if (request.params.name === FIND_REUSABLE_DATA.name) {
      const need = args.need;
      if (typeof need !== "string" || need.length === 0 || need.length > 2000) {
        throw new McpError(ErrorCode.InvalidParams, "A need argument (1-2000 chars) is required.");
      }
      return {
        description: FIND_REUSABLE_DATA.description,
        messages: buildFindReusableDataMessages(need),
      };
    }
    throw new McpError(ErrorCode.MethodNotFound, `Unknown prompt: ${request.params.name}`);
  });

  return server;
}
