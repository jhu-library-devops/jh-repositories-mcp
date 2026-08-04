# =============================================================================
# JHU Repository MCP Server — Production Environment
# Usage: tofu plan -var-file=prod.tfvars
# =============================================================================

environment = "prod"
aws_region  = "us-east-1"

# -----------------------------------------------------------------------------
# Networking (shared VPC used by DSpace and Dataverse clusters)
# -----------------------------------------------------------------------------
vpc_id             = "vpc-099e345c3ac73dd47"
public_subnet_ids  = ["subnet-0aff695440ed9d90b", "subnet-00e51cb88bd793e6f"]
private_subnet_ids = ["subnet-022e837a0764b1822", "subnet-08d7b2cd3c6540d88"]

# -----------------------------------------------------------------------------
# TLS (wildcard or SAN cert covering both hostnames)
# -----------------------------------------------------------------------------
certificate_arn = "arn:aws:acm:us-east-1:390157243417:certificate/f6e78a6b-837a-4b94-a84f-912fed7bcb35"

# -----------------------------------------------------------------------------
# Public Hostnames (both needed for ALB allowed-hostnames list)
# -----------------------------------------------------------------------------
stage_hostname = "mcp-stage.library.jhu.edu"
prod_hostname  = "mcp.library.jhu.edu"

# -----------------------------------------------------------------------------
# Container Image
# CI/CD updates this after build. Prod uses :prod tag or digest.
# -----------------------------------------------------------------------------
container_image = "390157243417.dkr.ecr.us-east-1.amazonaws.com/jhu/repository-mcp:prod"

# -----------------------------------------------------------------------------
# ECS Sizing
# -----------------------------------------------------------------------------
task_cpu    = 512
task_memory = 1024

# -----------------------------------------------------------------------------
# ECS Scaling — 2 tasks minimum, autoscale to 6
# -----------------------------------------------------------------------------
service_desired_count = 2
service_min_count     = 2
service_max_count     = 6

# -----------------------------------------------------------------------------
# WAF
# -----------------------------------------------------------------------------
waf_rate_limit = 300

# -----------------------------------------------------------------------------
# Cross-Stack Security Group IDs
# Dataverse not yet deployed — set to null.
# -----------------------------------------------------------------------------
dspace_solr_sg_id    = "sg-0f04633bb3d7098bf"
dspace_api_sg_id     = "sg-050c77fd4bd1d2123"
dataverse_solr_sg_id = null
dataverse_api_sg_id  = null

# -----------------------------------------------------------------------------
# Application Endpoints
# Internal service-discovery DNS within the shared VPC.
# Dataverse not yet deployed.
# -----------------------------------------------------------------------------
jscholarship_solr_url   = "http://solr.dspace-prod.local:8983/solr/search"
jscholarship_api_url    = "http://internal-private-dspace-prod-alb-1152535037.us-east-1.elb.amazonaws.com/server/api"
jscholarship_public_url = "https://jscholarship.library.jhu.edu"

jhrdr_solr_url   = ""
jhrdr_api_url    = ""
jhrdr_public_url = ""

# -----------------------------------------------------------------------------
# Observability
# -----------------------------------------------------------------------------
log_retention_days  = 90
alarm_sns_topic_arn = "arn:aws:sns:us-east-1:390157243417:dspace-stage-alerts"

# -----------------------------------------------------------------------------
# Tags
# -----------------------------------------------------------------------------
tags = {
  Owner  = "drcc"
  System = "repository-mcp"
}
