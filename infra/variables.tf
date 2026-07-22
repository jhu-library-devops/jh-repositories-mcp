# =============================================================================
# ROOT VARIABLES
# =============================================================================

variable "aws_region" {
  description = "AWS region."
  type        = string
  default     = "us-east-1"
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
# Hostnames
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
# Container images (per environment)
# -----------------------------------------------------------------------------

variable "stage_container_image" {
  description = "Container image URI for the stage MCP service."
  type        = string
}

variable "prod_container_image" {
  description = "Container image URI for the production MCP service."
  type        = string
}

# -----------------------------------------------------------------------------
# ECS sizing
# -----------------------------------------------------------------------------

variable "stage_task_cpu" {
  description = "Fargate task CPU for stage."
  type        = number
  default     = 512
}

variable "stage_task_memory" {
  description = "Fargate task memory (MiB) for stage."
  type        = number
  default     = 1024
}

variable "prod_task_cpu" {
  description = "Fargate task CPU for production."
  type        = number
  default     = 512
}

variable "prod_task_memory" {
  description = "Fargate task memory (MiB) for production."
  type        = number
  default     = 1024
}

# -----------------------------------------------------------------------------
# ECS scaling
# -----------------------------------------------------------------------------

variable "stage_desired_count" {
  description = "Initial task count for stage."
  type        = number
  default     = 1
}

variable "stage_min_count" {
  description = "Min task count for stage autoscaling."
  type        = number
  default     = 1
}

variable "stage_max_count" {
  description = "Max task count for stage autoscaling."
  type        = number
  default     = 2
}

variable "prod_desired_count" {
  description = "Initial task count for production."
  type        = number
  default     = 2
}

variable "prod_min_count" {
  description = "Min task count for production autoscaling."
  type        = number
  default     = 2
}

variable "prod_max_count" {
  description = "Max task count for production autoscaling."
  type        = number
  default     = 6
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
# Cross-stack security group IDs — Stage
# -----------------------------------------------------------------------------

variable "stage_dspace_solr_sg_id" {
  description = "Stage DSpace Solr security group ID."
  type        = string
}

variable "stage_dspace_api_sg_id" {
  description = "Stage DSpace API (ECS service) security group ID."
  type        = string
}

variable "stage_dataverse_solr_sg_id" {
  description = "Stage Dataverse Solr security group ID. Null disables Dataverse SG rules."
  type        = string
  default     = null
}

variable "stage_dataverse_api_sg_id" {
  description = "Stage Dataverse API security group ID. Null disables Dataverse SG rules."
  type        = string
  default     = null
}

# -----------------------------------------------------------------------------
# Cross-stack security group IDs — Production
# -----------------------------------------------------------------------------

variable "prod_dspace_solr_sg_id" {
  description = "Prod DSpace Solr security group ID."
  type        = string
}

variable "prod_dspace_api_sg_id" {
  description = "Prod DSpace API (ECS service) security group ID."
  type        = string
}

variable "prod_dataverse_solr_sg_id" {
  description = "Prod Dataverse Solr security group ID. Null disables Dataverse SG rules."
  type        = string
  default     = null
}

variable "prod_dataverse_api_sg_id" {
  description = "Prod Dataverse API security group ID. Null disables Dataverse SG rules."
  type        = string
  default     = null
}

# -----------------------------------------------------------------------------
# Application endpoints — Stage
# -----------------------------------------------------------------------------

variable "stage_jscholarship_solr_url" {
  description = "Stage JScholarship Solr URL."
  type        = string
}

variable "stage_jscholarship_api_url" {
  description = "Stage DSpace REST API URL."
  type        = string
}

variable "stage_jscholarship_public_url" {
  description = "Stage JScholarship public base URL."
  type        = string
}

variable "stage_jhrdr_solr_url" {
  description = "Stage JHRDR Solr URL. Empty string disables."
  type        = string
  default     = ""
}

variable "stage_jhrdr_api_url" {
  description = "Stage Dataverse API URL. Empty string disables."
  type        = string
  default     = ""
}

variable "stage_jhrdr_public_url" {
  description = "Stage JHRDR public base URL. Empty string disables."
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Application endpoints — Production
# -----------------------------------------------------------------------------

variable "prod_jscholarship_solr_url" {
  description = "Prod JScholarship Solr URL."
  type        = string
}

variable "prod_jscholarship_api_url" {
  description = "Prod DSpace REST API URL."
  type        = string
}

variable "prod_jscholarship_public_url" {
  description = "Prod JScholarship public base URL."
  type        = string
}

variable "prod_jhrdr_solr_url" {
  description = "Prod JHRDR Solr URL. Empty string disables."
  type        = string
  default     = ""
}

variable "prod_jhrdr_api_url" {
  description = "Prod Dataverse API URL. Empty string disables."
  type        = string
  default     = ""
}

variable "prod_jhrdr_public_url" {
  description = "Prod JHRDR public base URL. Empty string disables."
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
