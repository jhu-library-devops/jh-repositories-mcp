# =============================================================================
# PER-ENVIRONMENT SERVICE OUTPUTS
# =============================================================================

output "ecs_service_name" {
  description = "ECS service name for this environment."
  value       = aws_ecs_service.mcp.name
}

output "ecs_service_arn" {
  description = "ECS service ARN."
  value       = aws_ecs_service.mcp.id
}

output "task_security_group_id" {
  description = "Task security group ID (for cross-stack reference)."
  value       = aws_security_group.task.id
}

output "target_group_arn" {
  description = "ALB target group ARN."
  value       = aws_lb_target_group.mcp.arn
}

output "public_endpoint" {
  description = "Public MCP endpoint URL for this environment."
  value       = "https://${var.public_hostname}/mcp"
}
