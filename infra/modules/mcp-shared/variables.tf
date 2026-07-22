# =============================================================================
# SHARED MCP INFRASTRUCTURE VARIABLES
# =============================================================================

variable "name_prefix" {
  description = "Prefix for shared resource names (e.g., jhu-repo-mcp)."
  type        = string
}

variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

# -----------------------------------------------------------------------------
# Networking (the shared ALB needs public subnets from one VPC)
# -----------------------------------------------------------------------------

variable "vpc_id" {
  description = "VPC ID where the shared ALB lives. Can be either the stage or prod DSpace VPC."
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for the internet-facing ALB."
  type        = list(string)
}

# -----------------------------------------------------------------------------
# TLS
# -----------------------------------------------------------------------------

variable "certificate_arn" {
  description = "ACM certificate ARN covering all MCP hostnames (wildcard or SAN)."
  type        = string
}

# -----------------------------------------------------------------------------
# Hostnames served by the ALB (used for WAF Host validation)
# -----------------------------------------------------------------------------

variable "allowed_hostnames" {
  description = "Set of public hostnames the ALB serves (for WAF Host header validation)."
  type        = set(string)
}

# -----------------------------------------------------------------------------
# WAF
# -----------------------------------------------------------------------------

variable "waf_rate_limit" {
  description = "Maximum requests per 5-minute window per IP before WAF blocks."
  type        = number
  default     = 300
}

variable "waf_body_size_limit" {
  description = "Maximum request body size in bytes enforced by WAF."
  type        = number
  default     = 65536
}

# -----------------------------------------------------------------------------
# Observability
# -----------------------------------------------------------------------------

variable "log_retention_days" {
  description = "CloudWatch log group retention in days."
  type        = number
  default     = 90
}

variable "alarm_sns_topic_arn" {
  description = "SNS topic ARN for CloudWatch alarms. Null disables alarm creation."
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
