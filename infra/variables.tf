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
# Cross-stack security group IDs — Dataverse (not yet deployed)
# -----------------------------------------------------------------------------

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
# Application endpoints — JScholarship public URL (env-specific)
# -----------------------------------------------------------------------------

variable "jscholarship_public_url" {
  description = "JScholarship public base URL for this environment."
  type        = string
}

# -----------------------------------------------------------------------------
# Application endpoints — JHRDR / Dataverse (not yet deployed)
# -----------------------------------------------------------------------------

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

# -----------------------------------------------------------------------------
# Tags
# -----------------------------------------------------------------------------

variable "tags" {
  description = "Common resource tags."
  type        = map(string)
  default     = {}
}
