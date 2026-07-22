# =============================================================================
# PER-ENVIRONMENT TASK SECURITY GROUP AND CROSS-STACK INGRESS
# All services live in the same VPC — direct SG-to-SG references work.
# =============================================================================

# -----------------------------------------------------------------------------
# Task Security Group
# -----------------------------------------------------------------------------

resource "aws_security_group" "task" {
  name_prefix = "${var.name_prefix}-task-"
  description = "MCP Fargate tasks (${var.environment})"
  vpc_id      = var.vpc_id
  tags        = merge(local.common_tags, { Name = "${var.name_prefix}-task" })

  lifecycle {
    create_before_destroy = true
  }
}

# Ingress: shared ALB -> task (application port)
resource "aws_vpc_security_group_ingress_rule" "task_from_alb" {
  security_group_id            = aws_security_group.task.id
  referenced_security_group_id = var.alb_security_group_id
  description                  = "Application traffic from the shared ALB"
  from_port                    = var.container_port
  to_port                      = var.container_port
  ip_protocol                  = "tcp"
}

# Egress: task -> DSpace Solr (port 8983)
resource "aws_vpc_security_group_egress_rule" "task_to_dspace_solr" {
  security_group_id            = aws_security_group.task.id
  referenced_security_group_id = var.dspace_solr_security_group_id
  description                  = "JScholarship Solr search collection"
  from_port                    = 8983
  to_port                      = 8983
  ip_protocol                  = "tcp"
}

# Egress: task -> DSpace API (port 8080)
resource "aws_vpc_security_group_egress_rule" "task_to_dspace_api" {
  security_group_id            = aws_security_group.task.id
  referenced_security_group_id = var.dspace_api_security_group_id
  description                  = "DSpace REST API"
  from_port                    = 8080
  to_port                      = 8080
  ip_protocol                  = "tcp"
}

# Egress: task -> DSpace private ALB (port 80)
resource "aws_vpc_security_group_egress_rule" "task_to_dspace_private_alb" {
  security_group_id            = aws_security_group.task.id
  referenced_security_group_id = var.dspace_api_security_group_id
  description                  = "DSpace private ALB HTTP"
  from_port                    = 80
  to_port                      = 80
  ip_protocol                  = "tcp"
}

# Egress: task -> Dataverse Solr (port 8983)
resource "aws_vpc_security_group_egress_rule" "task_to_dataverse_solr" {
  security_group_id            = aws_security_group.task.id
  referenced_security_group_id = var.dataverse_solr_security_group_id
  description                  = "JHRDR Dataverse Solr collection1"
  from_port                    = 8983
  to_port                      = 8983
  ip_protocol                  = "tcp"
}

# Egress: task -> Dataverse API (port 8080)
resource "aws_vpc_security_group_egress_rule" "task_to_dataverse_api" {
  security_group_id            = aws_security_group.task.id
  referenced_security_group_id = var.dataverse_api_security_group_id
  description                  = "Dataverse Native API"
  from_port                    = 8080
  to_port                      = 8080
  ip_protocol                  = "tcp"
}

# Egress: task -> HTTPS (AWS APIs: ECR, CloudWatch, SSM)
resource "aws_vpc_security_group_egress_rule" "task_to_https" {
  security_group_id = aws_security_group.task.id
  description       = "AWS APIs (ECR, CloudWatch, SSM for exec)"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

# Egress: task -> DNS (UDP)
resource "aws_vpc_security_group_egress_rule" "task_to_dns_udp" {
  security_group_id = aws_security_group.task.id
  description       = "DNS resolution"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 53
  to_port           = 53
  ip_protocol       = "udp"
}

# Egress: task -> DNS (TCP)
resource "aws_vpc_security_group_egress_rule" "task_to_dns_tcp" {
  security_group_id = aws_security_group.task.id
  description       = "DNS resolution (TCP)"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 53
  to_port           = 53
  ip_protocol       = "tcp"
}

# -----------------------------------------------------------------------------
# Cross-Stack Ingress Rules
# Owned by this module — allows MCP tasks into the repository backend services.
# -----------------------------------------------------------------------------

resource "aws_vpc_security_group_ingress_rule" "dspace_solr_from_mcp" {
  security_group_id            = var.dspace_solr_security_group_id
  referenced_security_group_id = aws_security_group.task.id
  description                  = "MCP ${var.environment}: Solr read"
  from_port                    = 8983
  to_port                      = 8983
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "dspace_api_from_mcp" {
  security_group_id            = var.dspace_api_security_group_id
  referenced_security_group_id = aws_security_group.task.id
  description                  = "MCP ${var.environment}: DSpace REST"
  from_port                    = 8080
  to_port                      = 8080
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "dspace_api_http_from_mcp" {
  security_group_id            = var.dspace_api_security_group_id
  referenced_security_group_id = aws_security_group.task.id
  description                  = "MCP ${var.environment}: DSpace private ALB HTTP"
  from_port                    = 80
  to_port                      = 80
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "dataverse_solr_from_mcp" {
  security_group_id            = var.dataverse_solr_security_group_id
  referenced_security_group_id = aws_security_group.task.id
  description                  = "MCP ${var.environment}: JHRDR Solr read"
  from_port                    = 8983
  to_port                      = 8983
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "dataverse_api_from_mcp" {
  security_group_id            = var.dataverse_api_security_group_id
  referenced_security_group_id = aws_security_group.task.id
  description                  = "MCP ${var.environment}: Dataverse API"
  from_port                    = 8080
  to_port                      = 8080
  ip_protocol                  = "tcp"
}
