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
# Observability
# -----------------------------------------------------------------------------

variable "log_retention_days" {
  description = "CloudWatch log group retention in days."
  type        = number
  default     = 90
}

# -----------------------------------------------------------------------------
# Tags
# -----------------------------------------------------------------------------

variable "tags" {
  description = "Common tags for all resources."
  type        = map(string)
  default     = {}
}
