/**
 * Environment Configuration Validation Tests
 *
 * TDD tests for task 2.3: environment configuration validation.
 * Requirements: 13.2-13.9, 14.3-14.6, 15.1, 15.8
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { loadConfig } from "../../src/config/env";

/** Minimal valid environment for JScholarship startup. */
function validEnv(): Record<string, string> {
  return {
    PORT: "3000",
    ENVIRONMENT: "stage",
    BUILD_VERSION: "1.0.0",
    BUILD_COMMIT: "abc123def",
    JSCHOLARSHIP_SOLR_URL: "http://solr.dspace-stage.local:8983/solr/search",
    JSCHOLARSHIP_API_URL: "http://internal-private-dspace-stage-alb.us-east-1.elb.amazonaws.com",
    JSCHOLARSHIP_PUBLIC_URL: "https://jscholarship.library.jhu.edu",
    ALLOWED_HOSTS: "mcp.library.jhu.edu",
  };
}

describe("loadConfig()", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear all env vars that loadConfig reads
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  test("returns valid config when all required vars are set", () => {
    Object.assign(process.env, validEnv());

    const config = loadConfig();

    expect(config.environment).toBe("stage");
    expect(config.port).toBe(3000);
    expect(config.buildVersion).toBe("1.0.0");
    expect(config.buildCommit).toBe("abc123def");
    expect(config.jscholarship.solrCollectionUrl).toBe(
      "http://solr.dspace-stage.local:8983/solr/search",
    );
    expect(config.jscholarship.apiBaseUrl).toBe(
      "http://internal-private-dspace-stage-alb.us-east-1.elb.amazonaws.com",
    );
    expect(config.jscholarship.publicBaseUrl).toBe(
      "https://jscholarship.library.jhu.edu",
    );
    expect(config.security.allowedHosts).toEqual(["mcp.library.jhu.edu"]);
  });

  test("throws when JSCHOLARSHIP_SOLR_URL is missing", () => {
    const env = validEnv();
    delete env.JSCHOLARSHIP_SOLR_URL;
    Object.assign(process.env, env);

    expect(() => loadConfig()).toThrow(/JSCHOLARSHIP_SOLR_URL/);
  });

  test("throws when ENVIRONMENT is invalid", () => {
    const env = validEnv();
    env.ENVIRONMENT = "development";
    Object.assign(process.env, env);

    expect(() => loadConfig()).toThrow(/ENVIRONMENT/);
  });

  test("throws when ALLOWED_HOSTS is empty", () => {
    const env = validEnv();
    env.ALLOWED_HOSTS = "";
    Object.assign(process.env, env);

    expect(() => loadConfig()).toThrow(/ALLOWED_HOSTS/);
  });

  test("uses defaults for optional values", () => {
    Object.assign(process.env, validEnv());

    const config = loadConfig();

    expect(config.timeouts.solrMs).toBe(5000);
    expect(config.timeouts.canonicalApiMs).toBe(5000);
    expect(config.timeouts.overallDeadlineMs).toBe(10000);
    expect(config.concurrency.maxToolConcurrency).toBe(10);
    expect(config.concurrency.maxCanonicalizationWorkers).toBe(5);
    expect(config.cache.searchTtlMs).toBe(60000);
    expect(config.cache.canonicalRecordTtlMs).toBe(60000);
    expect(config.cache.maxEntries).toBe(500);
    expect(config.security.maxBodyBytes).toBe(65536);
    expect(config.security.allowedOrigins).toEqual([]);
  });

  test("parses comma-separated ALLOWED_HOSTS into array", () => {
    const env = validEnv();
    env.ALLOWED_HOSTS = "host1.example.com,host2.example.com,host3.example.com";
    Object.assign(process.env, env);

    const config = loadConfig();

    expect(config.security.allowedHosts).toEqual([
      "host1.example.com",
      "host2.example.com",
      "host3.example.com",
    ]);
  });

  test("parses comma-separated ALLOWED_ORIGINS into array", () => {
    const env = validEnv();
    env.ALLOWED_ORIGINS = "https://hopgpt.jhu.edu,https://chat.jhu.edu";
    Object.assign(process.env, env);

    const config = loadConfig();

    expect(config.security.allowedOrigins).toEqual([
      "https://hopgpt.jhu.edu",
      "https://chat.jhu.edu",
    ]);
  });

  test("warns but does not throw when JHRDR vars are missing", () => {
    Object.assign(process.env, validEnv());
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const config = loadConfig();

    expect(config.jhrdr.solrCollectionUrl).toBe("");
    expect(config.jhrdr.apiBaseUrl).toBe("");
    expect(config.jhrdr.publicBaseUrl).toBe("https://archive.data.jhu.edu");
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test("rejects non-URL values for endpoint vars", () => {
    const env = validEnv();
    env.JSCHOLARSHIP_SOLR_URL = "not-a-url";
    Object.assign(process.env, env);

    expect(() => loadConfig()).toThrow(/JSCHOLARSHIP_SOLR_URL/);
  });

  test("rejects negative timeout values", () => {
    const env = validEnv();
    env.TIMEOUT_SOLR_MS = "-1000";
    Object.assign(process.env, env);

    expect(() => loadConfig()).toThrow(/TIMEOUT_SOLR_MS/);
  });

  test("clamps TIMEOUT_DEADLINE_MS to max 30000", () => {
    const env = validEnv();
    env.TIMEOUT_DEADLINE_MS = "60000";
    Object.assign(process.env, env);

    const config = loadConfig();

    expect(config.timeouts.overallDeadlineMs).toBe(30000);
  });

  test("accepts production as a valid ENVIRONMENT", () => {
    const env = validEnv();
    env.ENVIRONMENT = "production";
    Object.assign(process.env, env);

    const config = loadConfig();

    expect(config.environment).toBe("production");
  });

  test("uses default PORT when not set", () => {
    const env = validEnv();
    delete env.PORT;
    Object.assign(process.env, env);

    const config = loadConfig();

    expect(config.port).toBe(3000);
  });

  test("trims whitespace from comma-separated values", () => {
    const env = validEnv();
    env.ALLOWED_HOSTS = " host1.example.com , host2.example.com ";
    Object.assign(process.env, env);

    const config = loadConfig();

    expect(config.security.allowedHosts).toEqual([
      "host1.example.com",
      "host2.example.com",
    ]);
  });
});
