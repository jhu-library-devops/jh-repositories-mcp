#!/usr/bin/env bash
# =============================================================================
# Post-deployment smoke tests for the JHU Repository MCP Server.
#
# Validates that the deployed service is healthy and functional by checking
# health endpoints and executing MCP protocol operations.
#
# Usage:
#   ./scripts/smoke-test.sh <base-url>
#   ./scripts/smoke-test.sh https://mcp-stage.library.jhu.edu
#   SMOKE_TIMEOUT=90 ./scripts/smoke-test.sh https://mcp.library.jhu.edu
#
# Environment:
#   SMOKE_TIMEOUT  — total script timeout in seconds (default: 60)
#   REQUEST_TIMEOUT — per-request timeout in seconds (default: 10)
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed
# =============================================================================

set -uo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_URL="${1:-}"
SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-60}"
REQUEST_TIMEOUT="${REQUEST_TIMEOUT:-10}"

EXPECTED_TOOLS=("search_items" "get_item" "list_facets" "find_related_items" "explain_search")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

pass_count=0
fail_count=0

pass() {
  echo -e "${GREEN}PASS${NC} $1"
  ((pass_count++))
}

fail() {
  echo -e "${RED}FAIL${NC} $1"
  ((fail_count++))
}

warn() {
  echo -e "${YELLOW}WARN${NC} $1"
}

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

if [[ -z "$BASE_URL" ]]; then
  echo "Usage: $0 <base-url>"
  echo "  e.g. $0 https://mcp-stage.library.jhu.edu"
  exit 1
fi

# Strip trailing slash
BASE_URL="${BASE_URL%/}"

echo "=============================================="
echo " MCP Smoke Tests"
echo " Target: ${BASE_URL}"
echo " Timeout: ${SMOKE_TIMEOUT}s total, ${REQUEST_TIMEOUT}s per request"
echo "=============================================="
echo ""

# ---------------------------------------------------------------------------
# Check 1: /health/live returns 200
# ---------------------------------------------------------------------------

echo "--- Health Endpoints ---"

http_code=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time "$REQUEST_TIMEOUT" \
  "${BASE_URL}/health/live" 2>/dev/null) || http_code="000"

if [[ "$http_code" == "200" ]]; then
  pass "/health/live returned 200"
else
  fail "/health/live returned ${http_code} (expected 200)"
fi

# ---------------------------------------------------------------------------
# Check 2: /health/ready returns 200
# ---------------------------------------------------------------------------

http_code=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time "$REQUEST_TIMEOUT" \
  "${BASE_URL}/health/ready" 2>/dev/null) || http_code="000"

if [[ "$http_code" == "200" ]]; then
  pass "/health/ready returned 200"
else
  fail "/health/ready returned ${http_code} (expected 200)"
fi

echo ""
echo "--- MCP Protocol ---"

# ---------------------------------------------------------------------------
# Check 3: MCP initialize returns valid server capabilities
# ---------------------------------------------------------------------------

init_payload='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0.0"}}}'

init_response=$(curl -s --max-time "$REQUEST_TIMEOUT" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "$init_payload" \
  "${BASE_URL}/mcp" 2>/dev/null || echo "")

if [[ -z "$init_response" ]]; then
  fail "MCP initialize — no response received"
else
  # Check for jsonrpc field and result
  if echo "$init_response" | grep -q '"jsonrpc"' && echo "$init_response" | grep -q '"result"'; then
    # Verify server capabilities are present
    if echo "$init_response" | grep -q '"capabilities"'; then
      pass "MCP initialize returned valid server capabilities"
    else
      fail "MCP initialize response missing 'capabilities'"
    fi
  else
    fail "MCP initialize returned invalid JSON-RPC response"
    echo "  Response: $(echo "$init_response" | head -c 200)"
  fi
fi

# ---------------------------------------------------------------------------
# Check 4: Send initialized notification (fire-and-forget)
# ---------------------------------------------------------------------------

initialized_payload='{"jsonrpc":"2.0","method":"notifications/initialized"}'

curl -s --max-time "$REQUEST_TIMEOUT" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$initialized_payload" \
  "${BASE_URL}/mcp" >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# Check 5: tools/list returns all 5 expected tools
# ---------------------------------------------------------------------------

tools_payload='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

tools_response=$(curl -s --max-time "$REQUEST_TIMEOUT" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "$tools_payload" \
  "${BASE_URL}/mcp" 2>/dev/null || echo "")

if [[ -z "$tools_response" ]]; then
  fail "tools/list — no response received"
else
  missing_tools=()
  for tool in "${EXPECTED_TOOLS[@]}"; do
    if ! echo "$tools_response" | grep -q "\"$tool\""; then
      missing_tools+=("$tool")
    fi
  done

  if [[ ${#missing_tools[@]} -eq 0 ]]; then
    pass "tools/list returned all 5 expected tools"
  else
    fail "tools/list missing tools: ${missing_tools[*]}"
    echo "  Response: $(echo "$tools_response" | head -c 300)"
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "=============================================="
total=$((pass_count + fail_count))
echo " Results: ${pass_count}/${total} checks passed"

if [[ $fail_count -gt 0 ]]; then
  echo -e " Status: ${RED}FAILED${NC}"
  echo "=============================================="
  exit 1
else
  echo -e " Status: ${GREEN}ALL PASSED${NC}"
  echo "=============================================="
  exit 0
fi
