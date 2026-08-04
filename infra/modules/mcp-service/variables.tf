# =============================================================================
# PER-ENVIRONMENT MCP SERVICE VARIABLES
# =============================================================================

variable "environment" {
  description = "Environment name (stage or prod)."
  type        = string
}

variable "name_prefix" {
  description = "Prefix for environment-specific resource names (e.g., jhu-repo-mcp-stage)."
  type        = string
}

# -----------------------------------------------------------------------------
# Shared infrastructure references (from mcp-shared module)
# -----------------------------------------------------------------------------

variable "ecs_cluster_id" {
  description = "ECS cluster ID from the shared module."
  type        = string
}

variable "ecs_cluster_name" {
  description = "ECS cluster name from the shared module."
  type        = string
}

variable "execution_role_arn" {
  description = "ECS task execution role ARN from the shared module."
  type        = string
}

variable "task_role_arn" {
  description = "ECS task role ARN from the shared module."
  type        = string
}

variable "log_group_name" {
  description = "CloudWatch log group name from the shared module."
  type        = string
}

# -----------------------------------------------------------------------------
# Networking
# -----------------------------------------------------------------------------

variable "vpc_id" {
  description = "VPC ID for this environment's resources (ALB, tasks)."
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for the internet-facing ALB."
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Private subnet IDs where Fargate tasks attach ENIs."
  type        = list(string)
}

# -----------------------------------------------------------------------------
# TLS
# -----------------------------------------------------------------------------

variable "certificate_arn" {
  description = "ACM certificate ARN for the HTTPS listener."
  type        = string
}

# -----------------------------------------------------------------------------
# WAF
# -----------------------------------------------------------------------------

variable "waf_rate_limit" {
  description = "Maximum requests per 5-minute window per IP before WAF blocks."
  type        = number
  default     = 300
}

# -----------------------------------------------------------------------------
# Cross-stack security group IDs
# -----------------------------------------------------------------------------

variable "dspace_solr_security_group_id" {
  description = "Security group ID of the DSpace Solr service."
  type        = string
}

variable "dspace_api_security_group_id" {
  description = "Security group ID of the DSpace API service."
  type        = string
}

variable "dataverse_solr_security_group_id" {
  description = "Security group ID of the Dataverse Solr service. Null disables Dataverse Solr SG rules."
  type        = string
  default     = null
}

variable "dataverse_api_security_group_id" {
  description = "Security group ID of the Dataverse API service. Null disables Dataverse API SG rules."
  type        = string
  default     = null
}

# -----------------------------------------------------------------------------
# Container configuration
# -----------------------------------------------------------------------------

variable "container_image" {
  description = "Full container image URI with tag or digest."
  type        = string
}

variable "container_port" {
  description = "Port the MCP application listens on."
  type        = number
  default     = 3000
}

variable "task_cpu" {
  description = "Fargate task CPU units."
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "Fargate task memory in MiB."
  type        = number
  default     = 1024
}

# -----------------------------------------------------------------------------
# Capacity provider
# -----------------------------------------------------------------------------

variable "capacity_provider" {
  description = "Fargate capacity provider: FARGATE or FARGATE_SPOT."
  type        = string
  default     = "FARGATE"

  validation {
    condition     = contains(["FARGATE", "FARGATE_SPOT"], var.capacity_provider)
    error_message = "capacity_provider must be \"FARGATE\" or \"FARGATE_SPOT\"."
  }
}

# -----------------------------------------------------------------------------
# ECS service scaling
# -----------------------------------------------------------------------------

variable "service_desired_count" {
  description = "Initial desired task count."
  type        = number
  default     = 1
}

variable "service_min_count" {
  description = "Minimum task count for autoscaling."
  type        = number
  default     = 1
}

variable "service_max_count" {
  description = "Maximum task count for autoscaling."
  type        = number
  default     = 6
}

variable "autoscaling_cpu_target" {
  description = "Target average CPU utilization percentage."
  type        = number
  default     = 70
}

variable "autoscaling_requests_per_target" {
  description = "Target ALB request count per target."
  type        = number
  default     = 100
}

# -----------------------------------------------------------------------------
# Host-based routing
# -----------------------------------------------------------------------------

variable "public_hostname" {
  description = "Public hostname this environment responds to (for ALB listener rule)."
  type        = string
}

variable "listener_rule_priority" {
  description = "Priority for the host-based ALB listener rule (must be unique across environments)."
  type        = number
}

# -----------------------------------------------------------------------------
# Application environment variables
# -----------------------------------------------------------------------------

variable "jscholarship_solr_url" {
  description = "Internal JScholarship Solr URL."
  type        = string
}

variable "jscholarship_api_url" {
  description = "Internal DSpace REST API URL."
  type        = string
}

variable "jscholarship_public_url" {
  description = "Public JScholarship base URL for landing pages."
  type        = string
}

variable "jhrdr_solr_url" {
  description = "Internal JHRDR/Dataverse Solr URL."
  type        = string
}

variable "jhrdr_api_url" {
  description = "Internal Dataverse Native API URL."
  type        = string
}

variable "jhrdr_public_url" {
  description = "Public JHRDR base URL for landing pages."
  type        = string
}

# -----------------------------------------------------------------------------
# Observability
# -----------------------------------------------------------------------------

variable "alarm_sns_topic_arn" {
  description = "SNS topic ARN for CloudWatch alarms. Null disables alarms."
  type        = string
  default     = null
}

# -----------------------------------------------------------------------------
# Tags
# -----------------------------------------------------------------------------

variable "tags" {
  description = "Common tags for all resources."
  type        = map(string)
  default     = {}
}
