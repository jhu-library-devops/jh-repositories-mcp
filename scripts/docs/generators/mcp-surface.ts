/**
 * MCP surface reference, read from a live server over an in-memory transport
 * so the page shows exactly what tools/list, resources/templates/list,
 * prompts/list, and initialize advertise to clients.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createRepositoryServer } from "../../../src/mcp/registry";
import { flattenSchema } from "../json-schema";
import { GENERATED_BANNER, code, table } from "../lib";

import type { ToolContext } from "../../../src/mcp/tools/search-items";
import type { SchemaRow } from "../json-schema";
import type { Generated } from "./types";

interface ToolEntry {
  readonly name: string;
  readonly description: string;
  readonly inputRows: readonly SchemaRow[];
  readonly outputRows: readonly SchemaRow[];
  readonly annotations: Readonly<Record<string, unknown>>;
}

interface ResourceTemplateEntry {
  readonly uriTemplate: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
}

interface PromptEntry {
  readonly name: string;
  readonly description: string;
  readonly arguments: readonly { name: string; description: string; required: boolean }[];
}

interface Surface {
  readonly instructions: string;
  readonly tools: readonly ToolEntry[];
  readonly resourceTemplates: readonly ResourceTemplateEntry[];
  readonly prompts: readonly PromptEntry[];
}

async function readSurface(): Promise<Surface> {
  // The list handlers never touch adapters, so an empty context is enough.
  const context: ToolContext = { adapters: new Map() };
  const server = createRepositoryServer({
    name: "jh-repositories-mcp",
    version: "docs",
    context,
    observer: () => {},
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "docs-generator", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    const templates = await client.listResourceTemplates();
    const prompts = await client.listPrompts();
    return {
      instructions: client.getInstructions() ?? "",
      tools: tools.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        inputRows: flattenSchema(tool.inputSchema),
        outputRows: tool.outputSchema === undefined ? [] : flattenSchema(tool.outputSchema),
        annotations: tool.annotations ?? {},
      })),
      resourceTemplates: templates.resourceTemplates.map((template) => ({
        uriTemplate: template.uriTemplate,
        name: template.name,
        description: template.description ?? "",
        mimeType: template.mimeType ?? "",
      })),
      prompts: prompts.prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description ?? "",
        arguments: (prompt.arguments ?? []).map((argument) => ({
          name: argument.name,
          description: argument.description ?? "",
          required: argument.required === true,
        })),
      })),
    };
  } finally {
    await client.close();
    await server.close();
  }
}

function schemaTable(rows: readonly SchemaRow[], withRequired: boolean): string {
  if (rows.length === 0) {
    return "_No properties._";
  }
  const header = withRequired
    ? ["Field", "Type", "Required", "Default", "Constraints"]
    : ["Field", "Type", "Always present", "Constraints"];
  return table(
    header,
    rows.map((row) =>
      withRequired
        ? [code(row.path), row.type, row.required ? "yes" : "no", row.defaultValue, row.constraints]
        : [code(row.path), row.type, row.required ? "yes" : "no", row.constraints],
    ),
  );
}

function renderPage(surface: Surface): string {
  const sections: string[] = [
    GENERATED_BANNER,
    "",
    "# MCP surface",
    "",
    "The complete protocol surface the server advertises. It is closed and static: no tool, resource, or prompt is registered at runtime, every input schema rejects unknown properties, and every tool is annotated read-only.",
    "",
    "Field paths use `.` for nested objects and `[]` for array items.",
    "",
    "## Summary",
    "",
    summaryTable(surface),
    "",
    "## Tools",
  ];
  for (const tool of surface.tools) {
    const hints = Object.entries(tool.annotations)
      .map(([key, value]) => `${code(key)}: ${code(String(value))}`)
      .join(", ");
    sections.push(
      "",
      `### ${tool.name}`,
      "",
      tool.description,
      "",
      `Annotations: ${hints || "none"}.`,
      "",
      "#### Input",
      "",
      schemaTable(tool.inputRows, true),
      "",
      "#### Output (`structuredContent`)",
      "",
      schemaTable(tool.outputRows, false),
    );
  }
  sections.push(
    "",
    "## Resource templates",
    "",
    "Reading a resource resolves through the same path as `get_item`, so it applies the same public-record gate and returns the same not-found shape.",
    "",
    table(
      ["URI template", "Name", "MIME type", "Description"],
      surface.resourceTemplates.map((template) => [
        code(template.uriTemplate),
        template.name,
        code(template.mimeType),
        template.description,
      ]),
    ),
    "",
    "## Prompts",
  );
  for (const prompt of surface.prompts) {
    sections.push(
      "",
      `### ${prompt.name}`,
      "",
      prompt.description,
      "",
      table(
        ["Argument", "Required", "Description"],
        prompt.arguments.map((argument) => [
          code(argument.name),
          argument.required ? "yes" : "no",
          argument.description,
        ]),
      ),
    );
  }
  sections.push(
    "",
    "## Server instructions",
    "",
    "Returned in every `initialize` response. Clients that surface server instructions pass this text to the host model.",
    "",
    "```text",
    surface.instructions.trimEnd(),
    "```",
    "",
  );
  return sections.join("\n");
}

function summaryTable(surface: Surface): string {
  return table(
    ["Type", "Name", "Purpose"],
    [
      ...surface.tools.map((tool) => ["Tool", code(tool.name), tool.description]),
      ...surface.resourceTemplates.map((template) => [
        "Resource",
        code(template.uriTemplate),
        template.description,
      ]),
      ...surface.prompts.map((prompt) => ["Prompt", code(prompt.name), prompt.description]),
    ],
  );
}

export async function generateMcpSurface(): Promise<Generated> {
  const surface = await readSurface();
  return {
    files: [{ path: "docs/reference/mcp-surface.md", content: renderPage(surface) }],
    regions: [{ name: "mcp-surface-summary", content: summaryTable(surface) }],
  };
}
