provider "aws" {
  region = var.aws_region
}

locals {
  name_prefix     = "jhu-repo-mcp"
  service_prefix  = "${local.name_prefix}-${var.environment}"
  public_hostname = var.environment == "prod" ? var.prod_hostname : var.stage_hostname

  # Listener rule priority: stage=100, prod=200 (matches original layout)
  listener_rule_priority = var.environment == "prod" ? 200 : 100
}

# =============================================================================
# SHARED INFRASTRUCTURE
# Single ECS cluster, ECR, ALB, WAF, IAM roles, and log group.
# =============================================================================

module "shared" {
  source = "./modules/mcp-shared"

  name_prefix = local.name_prefix
  aws_region  = var.aws_region

  vpc_id            = var.vpc_id
  public_subnet_ids = var.public_subnet_ids

  certificate_arn   = var.certificate_arn
  allowed_hostnames = [var.stage_hostname, var.prod_hostname]

  waf_rate_limit      = var.waf_rate_limit
  log_retention_days  = var.log_retention_days
  alarm_sns_topic_arn = var.alarm_sns_topic_arn

  tags = var.tags
}

# =============================================================================
# ENVIRONMENT SERVICE (stage OR prod, selected by var.environment)
# =============================================================================

module "service" {
  source = "./modules/mcp-service"

  environment = var.environment
  name_prefix = local.service_prefix

  # Shared infra
  ecs_cluster_id        = module.shared.ecs_cluster_id
  ecs_cluster_name      = module.shared.ecs_cluster_name
  https_listener_arn    = module.shared.https_listener_arn
  alb_arn_suffix        = module.shared.alb_arn_suffix
  alb_security_group_id = module.shared.alb_security_group_id
  execution_role_arn    = module.shared.execution_role_arn
  task_role_arn         = module.shared.task_role_arn
  log_group_name        = module.shared.log_group_name

  # Networking (same VPC)
  vpc_id             = var.vpc_id
  private_subnet_ids = var.private_subnet_ids

  # Cross-stack security groups
  dspace_solr_security_group_id    = var.dspace_solr_sg_id
  dspace_api_security_group_id     = var.dspace_api_sg_id
  dataverse_solr_security_group_id = var.dataverse_solr_sg_id
  dataverse_api_security_group_id  = var.dataverse_api_sg_id

  # Container
  container_image   = var.container_image
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
  jscholarship_solr_url   = var.jscholarship_solr_url
  jscholarship_api_url    = var.jscholarship_api_url
  jscholarship_public_url = var.jscholarship_public_url
  jhrdr_solr_url          = var.jhrdr_solr_url
  jhrdr_api_url           = var.jhrdr_api_url
  jhrdr_public_url        = var.jhrdr_public_url

  # Observability
  alarm_sns_topic_arn = var.alarm_sns_topic_arn

  tags = merge(var.tags, { Environment = var.environment })
}
