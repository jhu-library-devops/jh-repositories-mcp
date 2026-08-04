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

# Environment service
output "alb_dns_name" {
  description = "ALB DNS name (for CNAME or Cloudflare proxy)."
  value       = module.service.alb_dns_name
}

output "alb_zone_id" {
  description = "ALB Route 53 zone ID."
  value       = module.service.alb_zone_id
}

output "service_endpoint" {
  description = "MCP public endpoint for this environment."
  value       = module.service.public_endpoint
}

output "ecs_service_name" {
  description = "ECS service name for this environment."
  value       = module.service.ecs_service_name
}

output "task_sg_id" {
  description = "Task security group ID for this environment."
  value       = module.service.task_security_group_id
}
