# OpenTofu backend configuration for the Repository MCP stack.
#
# Each environment uses its own state file, selected at init time:
#
#   tofu init -backend-config=backend-stage.hcl   # stage state
#   tofu init -backend-config=backend-prod.hcl    # prod state
#
# Then plan/apply with the matching var file:
#
#   tofu plan  -var-file=stage.tfvars
#   tofu apply -var-file=stage.tfvars
#
# Prerequisites:
# 1. S3 bucket: jhu-drcc-tf-state-bucket (shared with other JHU stacks)
# 2. DynamoDB table: jhu-dspace-tf-locks (shared lock table)

terraform {
  backend "s3" {}
}
