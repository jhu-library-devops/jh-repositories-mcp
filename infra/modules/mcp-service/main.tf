# =============================================================================
# PER-ENVIRONMENT MCP SERVICE
# Task definition, ECS service, target group, host-based listener rule.
# =============================================================================

data "aws_region" "current" {}

locals {
  container_name = "repository-mcp"

  common_tags = merge(var.tags, {
    Application = "repository-mcp"
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  })

  container_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = tostring(var.container_port) },
    { name = "ENVIRONMENT", value = var.environment },
    { name = "JSCHOLARSHIP_SOLR_URL", value = var.jscholarship_solr_url },
    { name = "JSCHOLARSHIP_API_URL", value = var.jscholarship_api_url },
    { name = "JSCHOLARSHIP_PUBLIC_URL", value = var.jscholarship_public_url },
    { name = "JHRDR_SOLR_URL", value = var.jhrdr_solr_url },
    { name = "JHRDR_API_URL", value = var.jhrdr_api_url },
    { name = "JHRDR_PUBLIC_URL", value = var.jhrdr_public_url },
    { name = "LOG_LEVEL", value = var.environment == "prod" ? "info" : "debug" },
  ]
}

# -----------------------------------------------------------------------------
# Task Definition
# -----------------------------------------------------------------------------

resource "aws_ecs_task_definition" "mcp" {
  family                   = "${var.name_prefix}-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = tostring(var.task_cpu)
  memory                   = tostring(var.task_memory)
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = local.container_name
      image     = var.container_image
      essential = true

      portMappings = [
        {
          name          = "mcp-http"
          containerPort = var.container_port
          hostPort      = var.container_port
          protocol      = "tcp"
          appProtocol   = "http"
        }
      ]

      environment = local.container_environment

      healthCheck = {
        command     = ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:${var.container_port}/health/live || exit 1"]
        interval    = 15
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }

      readonlyRootFilesystem = true

      linuxParameters = {
        initProcessEnabled = true
        tmpfs = [
          {
            containerPath = "/tmp"
            size          = 64
            mountOptions  = ["rw", "noexec", "nosuid"]
          }
        ]
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.log_group_name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = var.environment
        }
      }

      stopTimeout = 30
    }
  ])

  tags = local.common_tags

  lifecycle {
    precondition {
      condition     = var.service_min_count <= var.service_desired_count && var.service_desired_count <= var.service_max_count
      error_message = "service_desired_count must be between service_min_count and service_max_count."
    }
  }
}

# -----------------------------------------------------------------------------
# Target Group
# -----------------------------------------------------------------------------

resource "aws_lb_target_group" "mcp" {
  name                 = substr("${var.name_prefix}-tg", 0, 32)
  port                 = var.container_port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
    path                = "/health/ready"
    protocol            = "HTTP"
    matcher             = "200"
  }

  tags = local.common_tags
}

# -----------------------------------------------------------------------------
# ALB Listener Rule (host-based routing)
# -----------------------------------------------------------------------------

resource "aws_lb_listener_rule" "mcp" {
  listener_arn = var.https_listener_arn
  priority     = var.listener_rule_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.mcp.arn
  }

  condition {
    host_header {
      values = [var.public_hostname]
    }
  }

  tags = local.common_tags
}

# -----------------------------------------------------------------------------
# ECS Service
# -----------------------------------------------------------------------------

resource "aws_ecs_service" "mcp" {
  name             = "${var.name_prefix}-service"
  cluster          = var.ecs_cluster_id
  task_definition  = aws_ecs_task_definition.mcp.arn
  desired_count    = var.service_desired_count
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  enable_execute_command             = true
  health_check_grace_period_seconds  = 60
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  wait_for_steady_state              = false

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    assign_public_ip = false
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.task.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.mcp.arn
    container_name   = local.container_name
    container_port   = var.container_port
  }

  tags = local.common_tags

  depends_on = [aws_lb_listener_rule.mcp]

  lifecycle {
    ignore_changes = [desired_count]
  }
}
