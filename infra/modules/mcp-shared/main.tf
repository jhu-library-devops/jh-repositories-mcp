# =============================================================================
# SHARED MCP INFRASTRUCTURE
# Single ECS cluster, ECR repository, and CloudWatch log group serving both
# stage and prod MCP services.
# =============================================================================

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  common_tags = merge(var.tags, {
    Application = "repository-mcp"
    ManagedBy   = "OpenTofu"
  })
}

# -----------------------------------------------------------------------------
# ECR Repository (shared image store for all environments)
# -----------------------------------------------------------------------------

resource "aws_ecr_repository" "mcp" {
  name                 = "jhu/repository-mcp"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.common_tags
}

resource "aws_ecr_lifecycle_policy" "mcp" {
  repository = aws_ecr_repository.mcp.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 30 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 30
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# ECS Cluster (single cluster for both stage and prod services)
# -----------------------------------------------------------------------------

resource "aws_ecs_cluster" "mcp" {
  name = "${var.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enhanced"
  }

  tags = local.common_tags
}

# -----------------------------------------------------------------------------
# CloudWatch Log Group (shared; services use stream prefixes to separate)
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "mcp" {
  name              = "/aws/ecs/${var.name_prefix}"
  retention_in_days = var.log_retention_days
  tags              = local.common_tags
}
