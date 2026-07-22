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

output "alb_arn" {
  description = "Public ALB ARN."
  value       = aws_lb.mcp.arn
}

output "alb_arn_suffix" {
  description = "Public ALB ARN suffix (for CloudWatch metrics)."
  value       = aws_lb.mcp.arn_suffix
}

output "alb_dns_name" {
  description = "Public ALB DNS name."
  value       = aws_lb.mcp.dns_name
}

output "alb_zone_id" {
  description = "Public ALB Route 53 zone ID."
  value       = aws_lb.mcp.zone_id
}

output "alb_security_group_id" {
  description = "ALB security group ID."
  value       = aws_security_group.alb.id
}

output "https_listener_arn" {
  description = "HTTPS listener ARN (for per-env listener rules)."
  value       = aws_lb_listener.https.arn
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

output "waf_web_acl_arn" {
  description = "WAF Web ACL ARN."
  value       = aws_wafv2_web_acl.mcp.arn
}
