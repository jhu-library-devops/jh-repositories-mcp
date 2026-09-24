# =============================================================================
# JHU Repository MCP Server — Stage Environment
# Usage:
#   tofu init -backend-config=backend-stage.hcl
#   tofu plan -var-file=stage.tfvars
#
# Networking, DSpace security groups, Solr URL, and internal ALB are
# resolved automatically from the DSpace stage remote state.
# =============================================================================

environment = "stage"
aws_region  = "us-east-1"

# -----------------------------------------------------------------------------
# Public Hostnames
# -----------------------------------------------------------------------------
stage_hostname = "mcp-stage.library.jhu.edu"
prod_hostname  = "mcp.library.jhu.edu"

# -----------------------------------------------------------------------------
# ECS Sizing
# -----------------------------------------------------------------------------
capacity_provider = "FARGATE_SPOT"
task_cpu          = 512
task_memory       = 1024

# -----------------------------------------------------------------------------
# ECS Scaling — 1 task, scale to 2 if needed
# -----------------------------------------------------------------------------
service_desired_count = 1
service_min_count     = 1
service_max_count     = 2

# -----------------------------------------------------------------------------
# WAF
# -----------------------------------------------------------------------------
waf_rate_limit = 300

# -----------------------------------------------------------------------------
# JScholarship public URL (stage-specific)
# -----------------------------------------------------------------------------
jscholarship_public_url = "https://dspace-stage.library.jhu.edu"

# -----------------------------------------------------------------------------
# Dataverse / JHRDR — not yet deployed
# -----------------------------------------------------------------------------
dataverse_solr_sg_id = null
dataverse_api_sg_id  = null
jhrdr_solr_url       = ""
jhrdr_api_url        = ""
jhrdr_public_url     = ""

# -----------------------------------------------------------------------------
# Observability
# -----------------------------------------------------------------------------
log_retention_days = 90

# -----------------------------------------------------------------------------
# Tags
# -----------------------------------------------------------------------------
tags = {
  Owner  = "drcc"
  System = "repository-mcp"
}
