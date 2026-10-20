/**
 * Safe Solr HTTP Client
 *
 * Executes SafeSolrQuery requests against one fixed collection base URL.
 * The URL is set at construction from validated environment configuration;
 * the client sends bounded POST form bodies, never follows redirects, and
 * can only reach the /select path of its collection — Solr admin,
 * update, and schema-write endpoints are unreachable by construction.
 *
 * Requirements: 10.5-10.7, 13.2-13.3
 */

import { withRetry } from "./retry";
import type { SafeSolrQuery } from "./solr-query";

/** Fetch signature accepted by the client; injectable for tests. */
export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

export interface SolrClientOptions {
  /** Per-request timeout in milliseconds; bounds the whole HTTP exchange. */
  readonly requestTimeoutMs: number;
  readonly fetchImpl?: FetchLike;
}

export class SolrRequestError extends Error {
  /** The failing call, for the operator fault log; /select is the only path. */
  readonly operation = "solr_select";

  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SolrRequestError";
  }
}

export class SolrClient {
  private readonly baseUrl: URL;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(collectionBaseUrl: URL, options: SolrClientOptions) {
    if (!Number.isInteger(options.requestTimeoutMs) || options.requestTimeoutMs < 1) {
      throw new SolrRequestError("requestTimeoutMs must be a positive integer");
    }
    // Normalize so path joining below cannot escape the collection.
    const normalized = new URL(collectionBaseUrl.toString());
    normalized.hash = "";
    normalized.search = "";
    if (!normalized.pathname.endsWith("/")) {
      normalized.pathname = `${normalized.pathname}/`;
    }
    this.baseUrl = normalized;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /**
   * Executes a built query. The only reachable path is the literal
   * SafeSolrQuery["path"], `/select`; anything else fails type-checking and,
   * defensively, this runtime guard.
   */
  async execute(query: SafeSolrQuery, signal?: AbortSignal): Promise<unknown> {
    if (query.path !== "/select") {
      throw new SolrRequestError(`Refusing non-allowlisted Solr path: ${query.path}`);
    }

    const target = new URL(`.${query.path}`, this.baseUrl);
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let response: Response;
    try {
      // Idempotent read: at most one retry for network faults and 5xx.
      response = await withRetry(
        async () => {
          const attempt = await this.fetchImpl(target, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: query.params.toString(),
            redirect: "error",
            signal: combined,
          });
          if (attempt.status >= 500) {
            throw new SolrRequestError(`Solr returned HTTP ${attempt.status}`, attempt.status);
          }
          return attempt;
        },
        {
          isTransient: (error) =>
            !(error instanceof SolrRequestError) ||
            error.status === undefined ||
            error.status >= 500,
        },
      );
    } catch (cause) {
      if (cause instanceof SolrRequestError) {
        throw cause;
      }
      throw new SolrRequestError(cause instanceof Error ? cause.message : "Solr request failed");
    }

    if (!response.ok) {
      throw new SolrRequestError(`Solr returned HTTP ${response.status}`, response.status);
    }
    return response.json();
  }
}
