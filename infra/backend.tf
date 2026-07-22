# OpenTofu backend configuration for the Repository MCP stack.
#
# Single state file covers both shared infrastructure and all environment
# services (stage + prod live in the same VPC and share one ECS cluster).
#
#   tofu init -backend-config=backend.hcl
#
# Prerequisites:
# 1. S3 bucket: jhu-drcc-tf-state-bucket (shared with other JHU stacks)
# 2. DynamoDB table: jhu-dspace-tf-locks (shared lock table)

terraform {
  backend "s3" {}
}
