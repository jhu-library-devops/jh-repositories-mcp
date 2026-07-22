# =============================================================================
# JHU Repository MCP Server — Single Stack Configuration
# Shared cluster + stage and prod services in the same VPC.
# =============================================================================

aws_region = "us-east-1"

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
# Public Hostnames (host-based ALB routing)
# -----------------------------------------------------------------------------
stage_hostname = "mcp-stage.library.jhu.edu"
prod_hostname  = "mcp.library.jhu.edu"

# DNS record creation (null = manage DNS externally / Cloudflare)
route53_zone_id = null

# -----------------------------------------------------------------------------
# Container Images
# CI/CD updates these after build. Stage uses :latest, prod uses digest.
# -----------------------------------------------------------------------------
stage_container_image = "390157243417.dkr.ecr.us-east-1.amazonaws.com/jhu/repository-mcp:stage"
prod_container_image  = "390157243417.dkr.ecr.us-east-1.amazonaws.com/jhu/repository-mcp:prod"

# -----------------------------------------------------------------------------
# ECS Sizing
# -----------------------------------------------------------------------------
stage_task_cpu    = 512
stage_task_memory = 1024
prod_task_cpu     = 512
prod_task_memory  = 1024

# -----------------------------------------------------------------------------
# ECS Scaling
# Stage: 1 task (scale to 2 if needed)
# Prod:  2 tasks minimum, autoscale to 6
# -----------------------------------------------------------------------------
stage_desired_count = 1
stage_min_count     = 1
stage_max_count     = 2

prod_desired_count = 2
prod_min_count     = 2
prod_max_count     = 6

# -----------------------------------------------------------------------------
# WAF
# -----------------------------------------------------------------------------
waf_rate_limit = 300

# -----------------------------------------------------------------------------
# Cross-Stack Security Group IDs — Stage
# Stage MCP runs in the prod VPC, so it connects to prod DSpace services.
# Dataverse not yet deployed — set to null.
# -----------------------------------------------------------------------------
stage_dspace_solr_sg_id    = "sg-0f04633bb3d7098bf"
stage_dspace_api_sg_id     = "sg-050c77fd4bd1d2123"
stage_dataverse_solr_sg_id = null
stage_dataverse_api_sg_id  = null

# -----------------------------------------------------------------------------
# Cross-Stack Security Group IDs — Production
# Dataverse not yet deployed — set to null.
# -----------------------------------------------------------------------------
prod_dspace_solr_sg_id    = "sg-0f04633bb3d7098bf"
prod_dspace_api_sg_id     = "sg-050c77fd4bd1d2123"
prod_dataverse_solr_sg_id = null
prod_dataverse_api_sg_id  = null

# -----------------------------------------------------------------------------
# Application Endpoints — Stage
# Internal service-discovery DNS within the shared VPC
# Dataverse not yet deployed.
# -----------------------------------------------------------------------------
stage_jscholarship_solr_url   = "http://solr.dspace-prod.local:8983/solr/search"
stage_jscholarship_api_url    = "http://internal-private-dspace-prod-alb-1152535037.us-east-1.elb.amazonaws.com/server/api"
stage_jscholarship_public_url = "https://jscholarship.library.jhu.edu"

stage_jhrdr_solr_url   = ""
stage_jhrdr_api_url    = ""
stage_jhrdr_public_url = ""

# -----------------------------------------------------------------------------
# Application Endpoints — Production
# Dataverse not yet deployed.
# -----------------------------------------------------------------------------
prod_jscholarship_solr_url   = "http://solr.dspace-prod.local:8983/solr/search"
prod_jscholarship_api_url    = "http://internal-private-dspace-prod-alb-1152535037.us-east-1.elb.amazonaws.com/server/api"
prod_jscholarship_public_url = "https://jscholarship.library.jhu.edu"

prod_jhrdr_solr_url   = ""
prod_jhrdr_api_url    = ""
prod_jhrdr_public_url = ""

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
