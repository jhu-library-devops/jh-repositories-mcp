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
#   SMOKE_QUERY    — search_items query expected to match public JScholarship
#                    records (default: Baltimore)
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
SMOKE_QUERY="${SMOKE_QUERY:-Baltimore}"

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

# POST one JSON-RPC payload to /mcp and print the response body ("" on failure).
mcp_call() {
  curl -s --max-time "$REQUEST_TIMEOUT" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "$1" \
    "${BASE_URL}/mcp" 2>/dev/null || echo ""
}

# A tools/call response is healthy when it has a result that is not a tool error.
tool_call_ok() {
  echo "$1" | grep -q '"result"' && ! echo "$1" | grep -q '"isError":true'
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
  -H "Accept: application/json, text/event-stream" \
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
  -H "Accept: application/json, text/event-stream" \
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
# Check 6: search_items returns a canonical JScholarship record
# (Solr candidates re-validated through DSpace REST)
# ---------------------------------------------------------------------------

echo ""
echo "--- Canonical Resolution ---"

search_payload="{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"search_items\",\"arguments\":{\"query\":\"${SMOKE_QUERY}\",\"repositories\":\"jscholarship\",\"limit\":1}}}"
search_response=$(mcp_call "$search_payload")

record_id=$(echo "$search_response" | grep -o '"id":"jscholarship:[0-9a-f-]\{36\}"' | head -1 | cut -d'"' -f4)
record_handle=$(echo "$search_response" | grep -o '"type":"handle","value":"[^"]*"' | head -1 | cut -d'"' -f8)

if [[ -n "$record_id" ]] && tool_call_ok "$search_response"; then
  pass "search_items returned ${record_id}"
else
  fail "search_items returned no JScholarship record for \"${SMOKE_QUERY}\""
  echo "  Response: $(echo "$search_response" | head -c 300)"
fi

# ---------------------------------------------------------------------------
# Check 7: get_item resolves that record by ID, with files and full metadata
# (DSpace item + bundles endpoints)
# ---------------------------------------------------------------------------

if [[ -n "$record_id" ]]; then
  get_payload="{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"get_item\",\"arguments\":{\"repository\":\"jscholarship\",\"identifier\":\"${record_id}\"}}}"
  get_response=$(mcp_call "$get_payload")
  if tool_call_ok "$get_response" && echo "$get_response" | grep -q '"metadata"'; then
    pass "get_item resolved ${record_id} with metadata"
    # Metadata still returns when DSpace cannot list files; flag it without
    # failing the deploy, since the fault is in DSpace, not this service.
    if echo "$get_response" | grep -q '"filesStatus":"unavailable"'; then
      warn "get_item returned ${record_id} without its file list (DSpace bundles call failed)"
    fi
  else
    fail "get_item failed for ${record_id}"
    echo "  Response: $(echo "$get_response" | head -c 300)"
  fi
else
  fail "get_item by ID skipped — no record from search_items"
fi

# ---------------------------------------------------------------------------
# Check 8: get_item resolves the same record by Handle (DSpace pid/find)
# ---------------------------------------------------------------------------

if [[ -n "$record_handle" ]]; then
  handle_payload="{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"get_item\",\"arguments\":{\"repository\":\"jscholarship\",\"identifier\":\"${record_handle}\"}}}"
  handle_response=$(mcp_call "$handle_payload")
  if tool_call_ok "$handle_response"; then
    pass "get_item resolved Handle ${record_handle}"
  else
    fail "get_item failed for Handle ${record_handle}"
    echo "  Response: $(echo "$handle_response" | head -c 300)"
  fi
else
  warn "get_item by Handle skipped — search result carried no Handle"
fi

# ---------------------------------------------------------------------------
# Check 9: find_related_items resolves the source and returns without error
# (JScholarship MoreLikeThis via the /select search component)
# ---------------------------------------------------------------------------

echo ""
echo "--- Related Records and Facets ---"

if [[ -n "$record_id" ]]; then
  related_payload="{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"tools/call\",\"params\":{\"name\":\"find_related_items\",\"arguments\":{\"repository\":\"jscholarship\",\"identifier\":\"${record_id}\",\"targetRepositories\":\"jscholarship\",\"limit\":3}}}"
  related_response=$(mcp_call "$related_payload")
  if tool_call_ok "$related_response"; then
    related_count=$(echo "$related_response" | grep -o '"count":[0-9]*' | head -1 | cut -d: -f2)
    pass "find_related_items returned ${related_count:-0} related record(s) for ${record_id}"
  else
    fail "find_related_items failed for ${record_id}"
    echo "  Response: $(echo "$related_response" | head -c 300)"
  fi
else
  fail "find_related_items skipped — no record from search_items"
fi

# ---------------------------------------------------------------------------
# Check 10: list_facets with no query aggregates every public record, and
# facet labels carry no DSpace index encoding ("value|||Value")
# ---------------------------------------------------------------------------

facets_payload='{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"list_facets","arguments":{"repositories":"jscholarship","facets":["repository","year","subject"]}}}'
facets_response=$(mcp_call "$facets_payload")
repo_total=$(echo "$facets_response" | grep -o '"label":"jscholarship","count":[0-9]*' | head -1 | cut -d: -f3)

if ! tool_call_ok "$facets_response"; then
  fail "list_facets without a query failed"
  echo "  Response: $(echo "$facets_response" | head -c 300)"
elif [[ -z "$repo_total" || "$repo_total" -eq 0 ]]; then
  fail "list_facets without a query matched no records"
  echo "  Response: $(echo "$facets_response" | head -c 300)"
elif ! echo "$facets_response" | grep -q '"facet":"year","values":\[{'; then
  fail "list_facets without a query returned no year values"
  echo "  Response: $(echo "$facets_response" | head -c 300)"
elif echo "$facets_response" | grep -q '|||'; then
  fail "list_facets labels still carry DSpace index encoding (|||)"
else
  pass "list_facets without a query covered ${repo_total} records with year and subject values"
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
