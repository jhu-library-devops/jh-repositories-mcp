# =============================================================================
# ROOT OUTPUTS
# =============================================================================

# Shared
output "ecs_cluster_name" {
  description = "Shared MCP ECS cluster name."
  value       = module.shared.ecs_cluster_name
}

output "ecr_repository_url" {
  description = "ECR repository URL for CI/CD image pushes."
  value       = module.shared.ecr_repository_url
}

output "alb_dns_name" {
  description = "Shared ALB DNS name (for CNAME or Cloudflare proxy)."
  value       = module.shared.alb_dns_name
}

output "alb_zone_id" {
  description = "Shared ALB Route 53 zone ID."
  value       = module.shared.alb_zone_id
}

# Stage
output "stage_endpoint" {
  description = "Stage MCP public endpoint."
  value       = module.stage.public_endpoint
}

output "stage_service_name" {
  description = "Stage ECS service name."
  value       = module.stage.ecs_service_name
}

output "stage_task_sg_id" {
  description = "Stage task security group ID."
  value       = module.stage.task_security_group_id
}

# Production
output "prod_endpoint" {
  description = "Production MCP public endpoint."
  value       = module.prod.public_endpoint
}

output "prod_service_name" {
  description = "Production ECS service name."
  value       = module.prod.ecs_service_name
}

output "prod_task_sg_id" {
  description = "Production task security group ID."
  value       = module.prod.task_security_group_id
}
