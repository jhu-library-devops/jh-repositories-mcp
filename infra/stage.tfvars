# =============================================================================
# JHU Repository MCP Server — Stage Environment
# Usage: tofu plan -var-file=stage.tfvars
# =============================================================================

environment = "stage"
aws_region  = "us-east-1"

# -----------------------------------------------------------------------------
# Networking (DSpace stage VPC)
# -----------------------------------------------------------------------------
vpc_id             = "vpc-07a15b94194398091"
public_subnet_ids  = ["subnet-02949f2d89b1ea2ef", "subnet-09bc7fa38848fb6ba"]
private_subnet_ids = ["subnet-00ff7878ce3580b9f", "subnet-0c094410fcd2b5e97"]

# -----------------------------------------------------------------------------
# TLS (wildcard or SAN cert covering both hostnames)
# -----------------------------------------------------------------------------
certificate_arn = "arn:aws:acm:us-east-1:390157243417:certificate/421e6e6e-9259-4270-9c11-020022c6f259"

# -----------------------------------------------------------------------------
# Public Hostnames (both needed for ALB allowed-hostnames list)
# -----------------------------------------------------------------------------
stage_hostname = "mcp-stage.library.jhu.edu"
prod_hostname  = "mcp.library.jhu.edu"

# -----------------------------------------------------------------------------
# Container Image
# CI/CD updates this after build. Stage uses :stage tag.
# -----------------------------------------------------------------------------
container_image = "390157243417.dkr.ecr.us-east-1.amazonaws.com/jhu/repository-mcp:stage"

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
# Cross-Stack Security Group IDs
# Stage MCP connects to DSpace stage services.
# Dataverse not yet deployed — set to null.
# -----------------------------------------------------------------------------
dspace_solr_sg_id    = "sg-0b6c16eeac34e071d"
dspace_api_sg_id     = "sg-016e167e731de03cb"
dataverse_solr_sg_id = null
dataverse_api_sg_id  = null

# -----------------------------------------------------------------------------
# Application Endpoints
# Internal DSpace stage ALB and service discovery.
# Dataverse not yet deployed.
# -----------------------------------------------------------------------------
jscholarship_solr_url   = "http://solr.dspace-stage.local:8983/solr/search"
jscholarship_api_url    = "http://internal-private-dspace-stage-alb-1049626423.us-east-1.elb.amazonaws.com/server/api"
jscholarship_public_url = "https://jscholarship-stage.library.jhu.edu"

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
