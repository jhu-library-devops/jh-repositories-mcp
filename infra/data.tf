# =============================================================================
# REMOTE STATE AND DATA SOURCES
# Pull networking, endpoints, and cross-stack references from the DSpace stack.
# =============================================================================

# -----------------------------------------------------------------------------
# DSpace Remote State (stage or prod, matches var.environment)
# -----------------------------------------------------------------------------

data "terraform_remote_state" "dspace" {
  backend = "s3"

  config = {
    bucket = "jhu-drcc-tf-state-bucket"
    key    = "dspace/${var.environment}/opentofu.tfstate"
    region = var.aws_region
  }
}

locals {
  dspace = data.terraform_remote_state.dspace.outputs

  # Networking from DSpace state
  dspace_vpc_id             = local.dspace.vpc_id
  dspace_public_subnet_ids  = slice(local.dspace.public_subnet_ids, 0, 2)
  dspace_private_subnet_ids = slice(local.dspace.private_subnet_ids, 0, 2)
  dspace_private_alb_dns    = local.dspace.private_alb_dns_name
  dspace_alarms_topic_arn   = data.aws_sns_topic.alerts.arn
}

# -----------------------------------------------------------------------------
# SNS Alerts Topic (shared with DSpace environment)
# -----------------------------------------------------------------------------

data "aws_sns_topic" "alerts" {
  name = "dspace-${var.environment}-alerts"
}
# -----------------------------------------------------------------------------
# ACM Certificate (lookup by domain)
# -----------------------------------------------------------------------------

data "aws_acm_certificate" "mcp" {
  domain      = "mcp.library.jhu.edu"
  statuses    = ["ISSUED"]
  most_recent = true
}

# -----------------------------------------------------------------------------
# DSpace Security Groups (lookup by name pattern within the env VPC)
# These aren't exposed as outputs from the DSpace stack.
# -----------------------------------------------------------------------------

data "aws_security_group" "dspace_solr" {
  vpc_id = local.dspace_vpc_id

  filter {
    name   = "group-name"
    values = ["dspace-${var.environment}-solr-sg"]
  }
}

data "aws_security_group" "dspace_ecs_service" {
  vpc_id = local.dspace_vpc_id

  filter {
    name   = "group-name"
    values = ["dspace-${var.environment}-ecs-service-sg"]
  }
}

# -----------------------------------------------------------------------------
# ECR Repository (from shared module, construct image URI)
# -----------------------------------------------------------------------------

locals {
  ecr_image = "${module.shared.ecr_repository_url}:${var.environment}"
}
