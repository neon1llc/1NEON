# One DynamoDB table for everything (single-table design), on demand, with point-in-time recovery.

variable "name" { type = string }

resource "aws_dynamodb_table" "main" {
  name                        = var.name
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "PK"
  range_key                   = "SK"
  deletion_protection_enabled = true

  # Key attributes only; every other field is schemaless.
  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
  attribute {
    name = "GSI1PK"
    type = "S"
  }
  attribute {
    name = "GSI1SK"
    type = "S"
  }
  attribute {
    name = "GSI2PK"
    type = "S"
  }
  attribute {
    name = "GSI2SK"
    type = "S"
  }

  # GSI1: a person's organizations. GSI2: every tenant and every project, for the All clients view.
  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }
  global_secondary_index {
    name            = "GSI2"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  # Edit markers and old audit rows expire on their own.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  # Restore to any second in the last 35 days.
  point_in_time_recovery { enabled = true }
  server_side_encryption { enabled = true }
}

output "name" { value = aws_dynamodb_table.main.name }
output "arn" { value = aws_dynamodb_table.main.arn }
