# =============================================================================
# SHARED MODULE OUTPUTS
# Consumed by per-environment mcp-service modules.
# =============================================================================

output "ecs_cluster_id" {
  description = "ECS cluster ID."
  value       = aws_ecs_cluster.mcp.id
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.mcp.name
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN."
  value       = aws_ecs_cluster.mcp.arn
}

output "ecr_repository_url" {
  description = "ECR repository URL for pushing images."
  value       = aws_ecr_repository.mcp.repository_url
}

output "ecr_repository_arn" {
  description = "ECR repository ARN."
  value       = aws_ecr_repository.mcp.arn
}

output "execution_role_arn" {
  description = "ECS task execution role ARN."
  value       = aws_iam_role.execution.arn
}

output "task_role_arn" {
  description = "ECS task role ARN."
  value       = aws_iam_role.task.arn
}

output "log_group_name" {
  description = "CloudWatch log group name."
  value       = aws_cloudwatch_log_group.mcp.name
}

output "log_group_arn" {
  description = "CloudWatch log group ARN."
  value       = aws_cloudwatch_log_group.mcp.arn
}
