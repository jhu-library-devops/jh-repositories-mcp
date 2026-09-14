# Implementation Plan

- [x] 1. Scaffold the project: package.json (Bun, pinned), strict tsconfig,
  dependencies (@modelcontextprotocol/sdk, hono, zod, fast-check dev),
  bunfig, .bun-version matching jh-repositories-mcp
  - _Requirements: 7.1_

- [x] 2. Corpus module with safety proofs
  - [x] 2.1 Property tests for resolveSafe (traversal, symlinks, encodings),
    verbatim reads, search literalness, freshness (T1–T4, ≥100 runs)
    - _Requirements: 1.2, 1.3, 1.4, 3.3, 5.1, 5.2_
  - [x] 2.2 Implement listPages/readPage/searchPages/resolveSafe to green
    - _Requirements: 1.1, 3.1, 3.2_

- [x] 3. MCP surface: per-request server with resources, search_pages tool
  (strict schemas), Server_Instructions; no write capability registered
  - _Requirements: 1.1, 1.2, 2.1, 3.1, 4.1_

- [x] 4. HTTP layer: Hono + streamable transport (stateless), /health/live,
  /health/ready with corpus+index check; read/search logging without content
  - _Requirements: 2.2, 7.1, 7.2, 7.4_

- [x] 5. Integration tests against a fixture corpus: initialize
  instructions, list/read, search, health, missing-index readiness failure,
  read-only-mount operation
  - _Requirements: 2.2, 4.2, 7.2_

- [x] 6. Verification pass: tsc --noEmit clean, bun test green, live smoke
  against the real kb/ corpus via curl (initialize, list, read index,
  search), README with run instructions
  - _Requirements: all_
