/**
 * VitePress configuration for the developer reference site, published to
 * GitHub Pages from main by .github/workflows/docs.yml.
 */

// External libraries
import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

// Internal modules
import { DEFAULT_BRANCH, REPOSITORY_URL, UNPUBLISHED_DIRS, rewriteRepositoryLink } from "./links";

// Type imports
import type { DefaultTheme, MarkdownRenderer } from "vitepress";

interface MarkdownEnv {
  readonly relativePath?: string;
}

function isMarkdownEnv(value: unknown): value is MarkdownEnv {
  return typeof value === "object" && value !== null;
}

function repositoryLinks(md: MarkdownRenderer): void {
  const previous = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, index, options, env: unknown, self) => {
    const token = tokens[index];
    const href = token?.attrGet("href");
    const pagePath = isMarkdownEnv(env) ? env.relativePath : undefined;
    if (token !== undefined && href !== null && href !== undefined && pagePath !== undefined) {
      token.attrSet("href", rewriteRepositoryLink(href, pagePath));
    }
    return previous === undefined
      ? self.renderToken(tokens, index, options)
      : previous(tokens, index, options, env, self);
  };
}

const sidebar: DefaultTheme.Sidebar = [
  {
    text: "Reference",
    items: [
      { text: "MCP surface", link: "/reference/mcp-surface" },
      { text: "Configuration", link: "/reference/configuration" },
      { text: "Repositories", link: "/reference/repositories" },
      { text: "Errors and warnings", link: "/reference/errors" },
      { text: "Infrastructure", link: "/reference/infrastructure" },
      { text: "Related resources", link: "/related-resources" },
      { text: "Glossary", link: "/glossary" },
    ],
  },
  {
    text: "Architecture",
    items: [
      { text: "Concepts", link: "/architecture/concepts" },
      { text: "Overview", link: "/architecture/overview" },
      { text: "Canonical gate", link: "/architecture/canonical-gate" },
      { text: "Federation and pagination", link: "/architecture/federation" },
      { text: "Security model", link: "/architecture/security" },
      { text: "Observability", link: "/architecture/observability" },
      { text: "Known limitations", link: "/architecture/known-limitations" },
    ],
  },
  {
    text: "Guides",
    items: [
      { text: "Run the server locally", link: "/guides/local-development" },
      { text: "Change the MCP surface", link: "/guides/change-the-mcp-surface" },
      { text: "Add a repository", link: "/guides/add-a-repository" },
      { text: "Write tests and fixtures", link: "/guides/testing-and-fixtures" },
      { text: "Deploy and roll back", link: "/guides/deploy-and-rollback" },
      { text: "Troubleshooting", link: "/guides/troubleshooting" },
      { text: "Maintain these docs", link: "/guides/maintaining-docs" },
    ],
  },
  {
    text: "Decisions",
    items: [
      { text: "All decision records", link: "/adr/" },
      {
        text: "001 One service per environment",
        link: "/adr/ADR-001-one-mcp-service-per-environment",
      },
      {
        text: "002 Pinned Bun, strict TypeScript",
        link: "/adr/ADR-002-pinned-bun-with-strict-typescript",
      },
      {
        text: "003 Hono and Web Standard transport",
        link: "/adr/ADR-003-hono-with-mcp-sdk-web-standard-transport",
      },
      {
        text: "004 Platform-specific adapters",
        link: "/adr/ADR-004-two-platform-specific-adapters",
      },
      {
        text: "005 Solr candidates, canonical gate",
        link: "/adr/ADR-005-solr-candidates-canonical-api-gate",
      },
      { text: "006 Stateless Streamable HTTP", link: "/adr/ADR-006-stateless-mcp-streamable-http" },
      { text: "007 Reciprocal-rank merge", link: "/adr/ADR-007-balanced-reciprocal-rank-merge" },
      { text: "008 Anonymous read-only access", link: "/adr/ADR-008-anonymous-read-only-v1" },
      {
        text: "009 Host model performs synthesis",
        link: "/adr/ADR-009-host-model-performs-synthesis",
      },
      {
        text: "010 Cross-repository service stack",
        link: "/adr/ADR-010-new-cross-repository-service-stack",
      },
      {
        text: "011 Search cache and the gate",
        link: "/adr/ADR-011-search-cache-never-bypasses-canonical-gate",
      },
      {
        text: "012 Cursor mismatch resets",
        link: "/adr/ADR-012-cursor-mismatch-resets-instead-of-errors",
      },
      {
        text: "013 N-repository federation",
        link: "/adr/ADR-013-n-repository-federation-through-an-adapter-registry",
      },
    ],
  },
];

export default withMermaid(
  defineConfig({
    title: "JHU Repositories MCP",
    description:
      "Developer reference for jh-repositories-mcp, a read-only MCP server for Johns Hopkins repositories.",
    lang: "en-US",
    base: "/jh-repositories-mcp/",
    cleanUrls: true,
    appearance: false,
    lastUpdated: false,
    srcExclude: UNPUBLISHED_DIRS.map((dir) => `${dir}**`),
    rewrites: { "adr/README.md": "adr/index.md" },
    head: [["meta", { name: "theme-color", content: "#002D72" }]],
    // Mermaid is one large lazily loaded chunk; the default 500 kB warning is noise here.
    vite: { build: { chunkSizeWarningLimit: 3000 } },
    // The default home layout renders no <main> landmark; doc pages do.
    transformHtml: (html: string): string =>
      html.replace(
        /<div class="VPContent is-home" id="VPContent"(?![^>]*role=)/,
        '<div class="VPContent is-home" id="VPContent" role="main"',
      ),
    markdown: {
      config: repositoryLinks,
      // Light-only site; the high-contrast palette keeps code comments above WCAG AA.
      theme: "github-light-high-contrast",
    },
    themeConfig: {
      siteTitle: "JHU Repositories MCP",
      nav: [
        { text: "Reference", link: "/reference/mcp-surface", activeMatch: "/reference/" },
        { text: "Architecture", link: "/architecture/concepts", activeMatch: "/architecture/" },
        { text: "Guides", link: "/guides/local-development", activeMatch: "/guides/" },
        { text: "Decisions", link: "/adr/", activeMatch: "/adr/" },
      ],
      sidebar,
      outline: { level: [2, 3], label: "On this page" },
      search: { provider: "local" },
      socialLinks: [{ icon: "github", link: REPOSITORY_URL, ariaLabel: "Source on GitHub" }],
      editLink: {
        pattern: `${REPOSITORY_URL}/edit/${DEFAULT_BRANCH}/docs/:path`,
        text: "Edit this page on GitHub",
      },
      footer: {
        message: `Released under the <a href="${REPOSITORY_URL}/blob/${DEFAULT_BRANCH}/LICENSE">Apache License 2.0</a>.`,
        copyright:
          "Copyright 2026 Johns Hopkins University Libraries. Authors: Steven J. Miklovic and Jared Galanis.",
      },
      docFooter: { prev: "Previous", next: "Next" },
    },
    mermaid: {
      theme: "base",
      themeVariables: {
        fontFamily: '"Work Sans", Tahoma, "Segoe UI", sans-serif',
        primaryColor: "#E9EEF6",
        primaryBorderColor: "#002D72",
        primaryTextColor: "#16213A",
        lineColor: "#4A5670",
        clusterBkg: "#F5F7FB",
        clusterBorder: "#D4DCE8",
      },
    },
  }),
);
