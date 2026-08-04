# OpenTofu backend configuration for the Repository MCP stack.
#
# Each environment uses its own state file, selected at init time:
#
#   tofu init -backend-config=environments/stage-backend.hcl
#   tofu init -backend-config=environments/prod-backend.hcl
#
# Then plan/apply with the matching var file:
#
#   tofu plan  -var-file=environments/stage.tfvars
#   tofu apply -var-file=environments/stage.tfvars
#
# Prerequisites:
# 1. S3 bucket: jhu-drcc-tf-state-bucket (shared with other JHU stacks)
# 2. DynamoDB table: jhu-dspace-tf-locks (shared lock table)

terraform {
  backend "s3" {}
}
