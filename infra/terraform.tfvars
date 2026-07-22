# =============================================================================
# JHU Repository MCP Server — Single Stack Configuration
# Shared cluster + stage and prod services in the same VPC.
# =============================================================================

aws_region = "us-east-1"

# -----------------------------------------------------------------------------
# Networking (shared VPC used by DSpace and Dataverse clusters)
# TODO: Populate from existing DSpace/Dataverse stack outputs or AWS console
# -----------------------------------------------------------------------------
vpc_id             = "vpc-PLACEHOLDER"
public_subnet_ids  = ["subnet-PLACEHOLDER-pub-1", "subnet-PLACEHOLDER-pub-2"]
private_subnet_ids = ["subnet-PLACEHOLDER-priv-1", "subnet-PLACEHOLDER-priv-2"]

# -----------------------------------------------------------------------------
# TLS (wildcard or SAN cert covering both hostnames)
# TODO: Create ACM certificate for *.mcp.library.jhu.edu or SAN cert
# -----------------------------------------------------------------------------
certificate_arn = "arn:aws:acm:us-east-1:390157243417:certificate/PLACEHOLDER-MCP-CERT"

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
# TODO: Populate from DSpace stage and Dataverse stage stack outputs
# -----------------------------------------------------------------------------
stage_dspace_solr_sg_id    = "sg-PLACEHOLDER-DSPACE-SOLR-STAGE"
stage_dspace_api_sg_id     = "sg-PLACEHOLDER-DSPACE-API-STAGE"
stage_dataverse_solr_sg_id = "sg-PLACEHOLDER-DATAVERSE-SOLR-STAGE"
stage_dataverse_api_sg_id  = "sg-PLACEHOLDER-DATAVERSE-API-STAGE"

# -----------------------------------------------------------------------------
# Cross-Stack Security Group IDs — Production
# TODO: Populate from DSpace prod and Dataverse prod stack outputs
# -----------------------------------------------------------------------------
prod_dspace_solr_sg_id    = "sg-PLACEHOLDER-DSPACE-SOLR-PROD"
prod_dspace_api_sg_id     = "sg-PLACEHOLDER-DSPACE-API-PROD"
prod_dataverse_solr_sg_id = "sg-PLACEHOLDER-DATAVERSE-SOLR-PROD"
prod_dataverse_api_sg_id  = "sg-PLACEHOLDER-DATAVERSE-API-PROD"

# -----------------------------------------------------------------------------
# Application Endpoints — Stage
# Internal service-discovery DNS within the shared VPC
# -----------------------------------------------------------------------------
stage_jscholarship_solr_url   = "http://solr.dspace-stage.local:8983/solr/search"
stage_jscholarship_api_url    = "http://stage.internal.dspace:80/server/api"
stage_jscholarship_public_url = "https://dspace-stage.library.jhu.edu"

stage_jhrdr_solr_url   = "http://solr.dataverse-stage.internal:8983/solr/collection1"
stage_jhrdr_api_url    = "http://dataverse.dataverse-stage.internal:8080/api"
stage_jhrdr_public_url = "https://dataverse-stage.library.jhu.edu"

# -----------------------------------------------------------------------------
# Application Endpoints — Production
# -----------------------------------------------------------------------------
prod_jscholarship_solr_url   = "http://solr.dspace-prod.local:8983/solr/search"
prod_jscholarship_api_url    = "http://prod.internal.dspace:80/server/api"
prod_jscholarship_public_url = "https://jscholarship.library.jhu.edu"

prod_jhrdr_solr_url   = "http://solr.dataverse-prod.internal:8983/solr/collection1"
prod_jhrdr_api_url    = "http://dataverse.dataverse-prod.internal:8080/api"
prod_jhrdr_public_url = "https://dataverse.library.jhu.edu"

# -----------------------------------------------------------------------------
# Observability
# -----------------------------------------------------------------------------
log_retention_days  = 90
alarm_sns_topic_arn = null # TODO: Use shared DSpace alerts topic or create a new one

# -----------------------------------------------------------------------------
# Tags
# -----------------------------------------------------------------------------
tags = {
  Owner  = "drcc"
  System = "repository-mcp"
}
