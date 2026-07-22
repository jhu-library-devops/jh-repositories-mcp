provider "aws" {
  region = var.aws_region
}

# =============================================================================
# SHARED INFRASTRUCTURE
# Single ECS cluster, ECR, ALB, WAF, IAM roles, and log group.
# =============================================================================

module "shared" {
  source = "./modules/mcp-shared"

  name_prefix = "jhu-repo-mcp"
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
# STAGE SERVICE
# =============================================================================

module "stage" {
  source = "./modules/mcp-service"

  environment = "stage"
  name_prefix = "jhu-repo-mcp-stage"

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

  # Cross-stack security groups (DSpace stage + Dataverse stage)
  dspace_solr_security_group_id    = var.stage_dspace_solr_sg_id
  dspace_api_security_group_id     = var.stage_dspace_api_sg_id
  dataverse_solr_security_group_id = var.stage_dataverse_solr_sg_id
  dataverse_api_security_group_id  = var.stage_dataverse_api_sg_id

  # Container
  container_image = var.stage_container_image
  task_cpu        = var.stage_task_cpu
  task_memory     = var.stage_task_memory

  # Scaling
  service_desired_count = var.stage_desired_count
  service_min_count     = var.stage_min_count
  service_max_count     = var.stage_max_count

  # Host-based routing
  public_hostname        = var.stage_hostname
  listener_rule_priority = 100

  # Application endpoints
  jscholarship_solr_url   = var.stage_jscholarship_solr_url
  jscholarship_api_url    = var.stage_jscholarship_api_url
  jscholarship_public_url = var.stage_jscholarship_public_url
  jhrdr_solr_url          = var.stage_jhrdr_solr_url
  jhrdr_api_url           = var.stage_jhrdr_api_url
  jhrdr_public_url        = var.stage_jhrdr_public_url

  # Observability
  alarm_sns_topic_arn = var.alarm_sns_topic_arn

  tags = merge(var.tags, { Environment = "stage" })
}

# =============================================================================
# PRODUCTION SERVICE
# =============================================================================

module "prod" {
  source = "./modules/mcp-service"

  environment = "prod"
  name_prefix = "jhu-repo-mcp-prod"

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

  # Cross-stack security groups (DSpace prod + Dataverse prod)
  dspace_solr_security_group_id    = var.prod_dspace_solr_sg_id
  dspace_api_security_group_id     = var.prod_dspace_api_sg_id
  dataverse_solr_security_group_id = var.prod_dataverse_solr_sg_id
  dataverse_api_security_group_id  = var.prod_dataverse_api_sg_id

  # Container
  container_image = var.prod_container_image
  task_cpu        = var.prod_task_cpu
  task_memory     = var.prod_task_memory

  # Scaling
  service_desired_count = var.prod_desired_count
  service_min_count     = var.prod_min_count
  service_max_count     = var.prod_max_count

  # Host-based routing
  public_hostname        = var.prod_hostname
  listener_rule_priority = 200

  # Application endpoints
  jscholarship_solr_url   = var.prod_jscholarship_solr_url
  jscholarship_api_url    = var.prod_jscholarship_api_url
  jscholarship_public_url = var.prod_jscholarship_public_url
  jhrdr_solr_url          = var.prod_jhrdr_solr_url
  jhrdr_api_url           = var.prod_jhrdr_api_url
  jhrdr_public_url        = var.prod_jhrdr_public_url

  # Observability
  alarm_sns_topic_arn = var.alarm_sns_topic_arn

  tags = merge(var.tags, { Environment = "prod" })
}
