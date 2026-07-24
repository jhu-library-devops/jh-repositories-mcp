/**
 * MCP Registry — Static Tool, Resource, and Prompt Registration
 *
 * Registers exactly the v1 MCP surface:
 *   Tools:     search_items, get_item, list_facets, find_related_items, explain_search
 *   Resources: jhu-repo://jscholarship/item/{encodedIdentifier}
 *              jhu-repo://jhrdr/dataset/{encodedIdentifier}
 *   Prompts:   explore_research_topic, find_reusable_data
 *
 * No dynamic tool creation. No write, admin, identity, download, HTTP-fetch,
 * database, or code-execution capability.
 *
 * Requirements: 12.3-12.5, 17
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface McpRegistryOptions {
  /** The MCP server instance to register tools/resources/prompts on. */
  server: McpServer;
}

/**
 * Register the static v1 MCP surface on the provided server.
 *
 * TODO: Implement full registration with input/output schemas,
 * handler wiring, and read-only annotations (task 16.1).
 */
export function createMcpRegistry(_options: McpRegistryOptions): void {
  // Placeholder — tools, resources, and prompts are registered in task 16.1.
  //
  // The v1 surface is fixed:
  //
  // Tools:
  //   - search_items: Search one or both repositories
  //   - get_item: Resolve a single public record
  //   - list_facets: Return common and repository-qualified facets
  //   - find_related_items: Discover related records
  //   - explain_search: Explain interpreted fields and filters
  //
  // Resources:
  //   - jhu-repo://jscholarship/item/{encodedIdentifier}
  //   - jhu-repo://jhrdr/dataset/{encodedIdentifier}
  //
  // Prompts:
  //   - explore_research_topic
  //   - find_reusable_data
}
