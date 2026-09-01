provider "aws" {
  region = var.aws_region
}

locals {
  name_prefix     = "jhu-repo-mcp"
  service_prefix  = "${local.name_prefix}-${var.environment}"
  public_hostname = var.environment == "prod" ? var.prod_hostname : var.stage_hostname

  # Listener rule priority: stage=100, prod=200
  listener_rule_priority = var.environment == "prod" ? 200 : 100

  # JScholarship endpoints derived from DSpace remote state.
  # Solr is fronted by the same private ALB on port 8983 — use the ALB DNS name
  # directly rather than the Cloud Map A record (solr.dspace-*.local), which holds
  # static IPs that go stale when the ALB's ENIs rotate.
  jscholarship_solr_url   = "http://${local.dspace_private_alb_dns}:8983/solr/search"
  jscholarship_api_url    = "http://${local.dspace_private_alb_dns}/server/api"
  jscholarship_public_url = var.jscholarship_public_url
}

# =============================================================================
# SHARED INFRASTRUCTURE
# ECS cluster, ECR, IAM roles, and log group.
# =============================================================================

module "shared" {
  source = "./modules/mcp-shared"

  name_prefix        = local.name_prefix
  aws_region         = var.aws_region
  log_retention_days = var.log_retention_days

  tags = var.tags
}

# =============================================================================
# ENVIRONMENT SERVICE (stage OR prod, selected by var.environment)
# Includes ALB, WAF, ECS service, and networking.
# =============================================================================

module "service" {
  source = "./modules/mcp-service"

  environment = var.environment
  name_prefix = local.service_prefix

  # Shared infra
  ecs_cluster_id     = module.shared.ecs_cluster_id
  ecs_cluster_name   = module.shared.ecs_cluster_name
  execution_role_arn = module.shared.execution_role_arn
  task_role_arn      = module.shared.task_role_arn
  log_group_name     = module.shared.log_group_name

  # Networking (from DSpace remote state)
  vpc_id             = local.dspace_vpc_id
  public_subnet_ids  = local.dspace_public_subnet_ids
  private_subnet_ids = local.dspace_private_subnet_ids

  # TLS (from ACM data source)
  certificate_arn = data.aws_acm_certificate.mcp.arn

  # WAF
  waf_rate_limit = var.waf_rate_limit

  # Cross-stack security groups (from data sources)
  dspace_solr_security_group_id    = data.aws_security_group.dspace_solr.id
  dspace_api_security_group_id     = data.aws_security_group.dspace_ecs_service.id
  dataverse_solr_security_group_id = var.dataverse_solr_sg_id
  dataverse_api_security_group_id  = var.dataverse_api_sg_id

  # Container (image URI constructed from ECR output)
  container_image   = local.ecr_image
  capacity_provider = var.capacity_provider
  task_cpu          = var.task_cpu
  task_memory       = var.task_memory

  # Scaling
  service_desired_count = var.service_desired_count
  service_min_count     = var.service_min_count
  service_max_count     = var.service_max_count

  # Host-based routing
  public_hostname        = local.public_hostname
  listener_rule_priority = local.listener_rule_priority

  # Application endpoints
  jscholarship_solr_url   = local.jscholarship_solr_url
  jscholarship_api_url    = local.jscholarship_api_url
  jscholarship_public_url = local.jscholarship_public_url
  jhrdr_solr_url          = var.jhrdr_solr_url
  jhrdr_api_url           = var.jhrdr_api_url
  jhrdr_public_url        = var.jhrdr_public_url

  # Observability
  alarm_sns_topic_arn = local.dspace_alarms_topic_arn

  tags = merge(var.tags, { Environment = var.environment })
}
