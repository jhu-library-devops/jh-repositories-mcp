/**
 * MCP Module — Public Interface
 *
 * Exports the MCP registry setup, tool/resource/prompt registration,
 * and the stateless Streamable HTTP transport for Hono.
 * The MCP surface is static: 5 tools, 2 resources, 2 prompts.
 *
 * Requirements: 12.1-12.2, 12.3-12.5, 12.7-12.8, 17
 */

export { createMcpRegistry, type McpRegistryOptions } from "./registry";
export { createMcpTransport, type McpTransportOptions } from "./transport";
