# =============================================================================
# ROOT VARIABLES
# =============================================================================

variable "aws_region" {
  description = "AWS region."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment: stage or prod."
  type        = string

  validation {
    condition     = contains(["stage", "prod"], var.environment)
    error_message = "environment must be \"stage\" or \"prod\"."
  }
}

# -----------------------------------------------------------------------------
# Networking (single VPC shared by DSpace, Dataverse, and MCP)
# -----------------------------------------------------------------------------

variable "vpc_id" {
  description = "VPC ID shared by all repository clusters."
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for the shared ALB."
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for MCP Fargate tasks."
  type        = list(string)
}

# -----------------------------------------------------------------------------
# TLS
# -----------------------------------------------------------------------------

variable "certificate_arn" {
  description = "ACM certificate ARN covering both MCP hostnames (wildcard or SAN)."
  type        = string
}

# -----------------------------------------------------------------------------
# Hostnames (both needed for ALB allowed-hostnames list)
# -----------------------------------------------------------------------------

variable "stage_hostname" {
  description = "Public hostname for the stage MCP endpoint."
  type        = string
}

variable "prod_hostname" {
  description = "Public hostname for the production MCP endpoint."
  type        = string
}

# -----------------------------------------------------------------------------
# DNS (optional)
# -----------------------------------------------------------------------------

variable "route53_zone_id" {
  description = "Route 53 hosted zone ID for creating DNS records. Null skips."
  type        = string
  default     = null
}

# -----------------------------------------------------------------------------
# Container image (for the deployed environment)
# -----------------------------------------------------------------------------

variable "container_image" {
  description = "Container image URI for the MCP service."
  type        = string
}

# -----------------------------------------------------------------------------
# Capacity provider
# -----------------------------------------------------------------------------

variable "capacity_provider" {
  description = "Fargate capacity provider: FARGATE or FARGATE_SPOT."
  type        = string
  default     = "FARGATE"
}

# -----------------------------------------------------------------------------
# ECS sizing
# -----------------------------------------------------------------------------

variable "task_cpu" {
  description = "Fargate task CPU units."
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "Fargate task memory (MiB)."
  type        = number
  default     = 1024
}

# -----------------------------------------------------------------------------
# ECS scaling
# -----------------------------------------------------------------------------

variable "service_desired_count" {
  description = "Initial task count."
  type        = number
  default     = 1
}

variable "service_min_count" {
  description = "Min task count for autoscaling."
  type        = number
  default     = 1
}

variable "service_max_count" {
  description = "Max task count for autoscaling."
  type        = number
  default     = 2
}

# -----------------------------------------------------------------------------
# WAF
# -----------------------------------------------------------------------------

variable "waf_rate_limit" {
  description = "WAF rate limit per 5-minute window per IP."
  type        = number
  default     = 300
}

# -----------------------------------------------------------------------------
# Cross-stack security group IDs
# -----------------------------------------------------------------------------

variable "dspace_solr_sg_id" {
  description = "DSpace Solr security group ID for this environment."
  type        = string
}

variable "dspace_api_sg_id" {
  description = "DSpace API (ECS service) security group ID for this environment."
  type        = string
}

variable "dataverse_solr_sg_id" {
  description = "Dataverse Solr security group ID. Null disables Dataverse SG rules."
  type        = string
  default     = null
}

variable "dataverse_api_sg_id" {
  description = "Dataverse API security group ID. Null disables Dataverse SG rules."
  type        = string
  default     = null
}

# -----------------------------------------------------------------------------
# Application endpoints
# -----------------------------------------------------------------------------

variable "jscholarship_solr_url" {
  description = "JScholarship Solr URL."
  type        = string
}

variable "jscholarship_api_url" {
  description = "DSpace REST API URL."
  type        = string
}

variable "jscholarship_public_url" {
  description = "JScholarship public base URL."
  type        = string
}

variable "jhrdr_solr_url" {
  description = "JHRDR Solr URL. Empty string disables."
  type        = string
  default     = ""
}

variable "jhrdr_api_url" {
  description = "Dataverse API URL. Empty string disables."
  type        = string
  default     = ""
}

variable "jhrdr_public_url" {
  description = "JHRDR public base URL. Empty string disables."
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Observability
# -----------------------------------------------------------------------------

variable "log_retention_days" {
  description = "CloudWatch log retention in days."
  type        = number
  default     = 90
}

variable "alarm_sns_topic_arn" {
  description = "SNS topic ARN for alarms. Null disables."
  type        = string
  default     = null
}

# -----------------------------------------------------------------------------
# Tags
# -----------------------------------------------------------------------------

variable "tags" {
  description = "Common resource tags."
  type        = map(string)
  default     = {}
}
