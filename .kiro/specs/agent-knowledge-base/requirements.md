# Requirements Document

## Introduction

The JHU Libraries AI Sandbox (LibreChat) can search institutional
repositories through the jhu-repository-mcp, but the assistant has no
access to curated institutional knowledge: what each repository contains,
how to search it well, current known issues, what the sandbox is and where
to refer users. Today that knowledge either doesn't reach the model at all
or is baked into static prompts that require an infrastructure deploy to
change.

This feature adds an **Agent Knowledge Base**: a corpus of curated
markdown pages (the KB_Corpus, piloted at `kb/` with five seed pages) and
a small read-only MCP server (the KB_Server) that serves those pages to AI
assistants. The agent reads whole pages and navigates between them by
links — no embeddings, no vector store — so what the model consulted is
always a reviewable page a human can open and edit. Page maintenance
happens through normal file editing and review in the corpus's repository;
the KB_Server never writes.

The design goal is the smallest useful version: the value is in the
content and its maintainability, not in the serving machinery.

## Glossary

- **KB_Corpus**: The set of markdown files under a single root directory,
  containing an `index.md` at the root. The authoritative content.
- **KB_Page**: One markdown file within the KB_Corpus.
- **Index_Page**: The KB_Corpus root `index.md` — the mandatory entry
  point holding navigation and a current-state snapshot.
- **KB_Server**: The read-only MCP server exposing the KB_Corpus.
- **Server_Instructions**: The `instructions` text the KB_Server returns
  in the MCP initialize handshake.
- **Page_URI**: The stable MCP resource URI identifying one KB_Page.
- **Verification_Date**: The "last verified" date a KB_Page declares for
  its facts.

## Requirements

### Requirement 1: Page access as MCP resources

**User Story:** As an AI assistant, I want to list and read knowledge-base
pages, so that I can consult curated institutional facts while answering.

#### Acceptance Criteria

1. THE KB_Server SHALL expose every KB_Page as an MCP resource with a
   stable Page_URI derived from its corpus-relative path.
2. WHEN a resource read is requested for a valid Page_URI THE KB_Server
   SHALL return the page's markdown content verbatim.
3. WHEN a resource read is requested for a URI outside the KB_Corpus
   (including via path traversal) THE KB_Server SHALL return a not-found
   error without revealing filesystem detail.
4. THE KB_Server SHALL expose only files with a markdown extension inside
   the KB_Corpus root; all other files SHALL be invisible to clients.

### Requirement 2: Entry-point guidance

**User Story:** As an AI assistant, I want to be told how to use the
knowledge base when I connect, so that I consult it correctly without
per-client configuration.

#### Acceptance Criteria

1. THE KB_Server SHALL return Server_Instructions in the initialize
   response directing clients to read the Index_Page first and navigate
   by links rather than guessing page names.
2. THE KB_Server SHALL fail readiness at startup IF the KB_Corpus lacks a
   readable Index_Page.

### Requirement 3: Search within the corpus

**User Story:** As an AI assistant, I want to find pages relevant to a
question, so that I do not have to read the whole corpus.

#### Acceptance Criteria

1. THE KB_Server SHALL provide a search tool that performs case-insensitive
   text matching over KB_Page contents and titles and returns, per match,
   the Page_URI, page title, and a short excerpt around the match.
2. WHEN the search tool returns no matches THE KB_Server SHALL return an
   empty result with a hint to consult the Index_Page, not an error.
3. THE search tool SHALL treat the query as literal text; no query syntax
   SHALL be interpreted, and unsafe input SHALL NOT alter search behavior.

### Requirement 4: Read-only guarantee

**User Story:** As the team accountable for the pilot, I want the serving
path to be provably read-only, so that content changes only happen through
reviewed edits in the corpus repository.

#### Acceptance Criteria

1. THE KB_Server SHALL expose no MCP tool, resource, or prompt that
   creates, modifies, or deletes KB_Corpus content.
2. THE KB_Server process SHALL function correctly with the KB_Corpus
   mounted read-only.

### Requirement 5: Content freshness and reload

**User Story:** As a KB maintainer, I want published edits to reach the
assistant promptly, so that fixing a page does not require a service
deploy.

#### Acceptance Criteria

1. WHEN a KB_Page changes on disk THE KB_Server SHALL serve the updated
   content no later than the next resource read (no restart required).
2. THE KB_Server SHALL NOT cache page content beyond a bounded staleness
   of 60 seconds.

### Requirement 6: Corpus conventions (content contract)

**User Story:** As a KB maintainer, I want a minimal page contract, so
that pages stay usable by cold-reading agents and auditable by humans.

#### Acceptance Criteria

1. THE Index_Page SHALL contain a navigation listing of all KB_Pages with
   one-line descriptions and a dated change log.
2. Each KB_Page SHALL declare a Verification_Date; pages WHERE facts are
   unverified SHALL say so explicitly.
3. Corpus conventions SHALL be documented in a README within the corpus
   repository; the README SHALL NOT be exposed as a KB resource if it is
   maintainer-facing (see Requirement 1.4 scoping decision in design).

### Requirement 7: Deployment posture

**User Story:** As the platform team, I want the KB_Server to match the
existing MCP deployment discipline, so that it adds no new operational
patterns.

#### Acceptance Criteria

1. THE KB_Server SHALL serve MCP over the streamable HTTP transport,
   statelessly, such that any instance can serve any request.
2. THE KB_Server SHALL provide dependency-free liveness and readiness
   endpoints; readiness SHALL fail while the KB_Corpus is unavailable.
3. THE KB_Server SHALL require no client authentication in v1 and SHALL
   therefore serve only content approved for all sandbox users.
4. THE KB_Server SHALL log page-read and search events without logging
   full page contents.

### Requirement 8: Scope boundaries (non-goals for v1)

**User Story:** As the task force, I want v1 deliberately narrow, so that
the pilot ships and the evaluation is about content value.

#### Acceptance Criteria

1. THE KB_Server SHALL NOT implement embeddings, vector search, or
   semantic ranking in v1.
2. THE KB_Server SHALL NOT implement write/edit tooling, user accounts,
   or per-user content in v1.
3. THE KB_Server SHALL NOT sync from external systems (LibGuides,
   Confluence, etc.) in v1; such pipelines require a revised spec.
4. Any capability outside this document SHALL require a new or revised
   spec before implementation.
