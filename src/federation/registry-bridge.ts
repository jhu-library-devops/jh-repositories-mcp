/**
 * Adapter-Map → Adapter_Registry Bridge
 *
 * The MCP tool handlers currently hold their adapters in a plain
 * `Map<RepositoryId, RepositoryAdapter>` on the `ToolContext` (constructed once
 * at process startup in `src/index.ts`). The generalized Federation_Service, by
 * contrast, resolves every adapter through an immutable `AdapterRegistry` and
 * names no concrete `RepositoryId` (design.md §1, Req 1.5).
 *
 * This thin bridge adapts the former to the latter without the handlers having
 * to build a registry themselves: it wraps an already-populated adapter map in a
 * `RegisteredAdapter` set and hands it to `createAdapterRegistry`. Every adapter
 * in the map was schema-validated at startup, so each is registered as eligible
 * at the equal default fusion weight — the backward-compatible behavior for the
 * initial `jscholarship` + `jhrdr` set (Req 9.3). Per-adapter weight
 * configuration and the full fatal-error `buildRegistry` path are wired at
 * process init by task 15.2; this bridge is the compatibility seam that lets the
 * service run against the existing `ToolContext` until then.
 *
 * The bridge holds no hardcoded RepositoryId: it derives the registered set
 * purely from the map's keys, so adding an adapter to the map adds it to the
 * registry with no change here.
 *
 * Requirements: 1.5, 9.3
 */

import type { RepositoryAdapter } from "../adapters/index";
import {
  type AdapterRegistry,
  DEFAULT_FUSION_WEIGHT,
  type RegisteredAdapter,
  createAdapterRegistry,
} from "../adapters/registry";
import type { RepositoryId } from "../models/index";

/**
 * Build an immutable {@link AdapterRegistry} from an already-populated adapter
 * map, registering each adapter as eligible at the equal default fusion weight.
 *
 * The map's adapters were validated at startup, so no schema re-check runs here;
 * every entry is treated as dispatch-eligible. Pass per-repository weights to
 * override the equal default for an id — an id absent from `weights` keeps
 * {@link DEFAULT_FUSION_WEIGHT}.
 */
export function createRegistryFromAdapters(
  adapters: ReadonlyMap<RepositoryId, RepositoryAdapter>,
  weights?: ReadonlyMap<RepositoryId, number>,
): AdapterRegistry {
  const registered: RegisteredAdapter[] = [];
  for (const adapter of adapters.values()) {
    registered.push({
      adapter,
      weight: weights?.get(adapter.id) ?? DEFAULT_FUSION_WEIGHT,
      eligible: true,
      ineligibleReason: null,
    });
  }
  return createAdapterRegistry(registered);
}
