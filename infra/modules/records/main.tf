# infra/modules/records/main.tf - Locked copies of signed agreements, approvals, acceptances, invoices,
# and payments. Object Lock (governance mode) keeps each copy unchanged for seven years; nothing here
# is ever deleted by a lifecycle rule, in line with neon1's keep-everything rule for client records.


# Inputs: the bucket name and how long each copy is locked
variable "name" { type = string }
variable "retain_years" {
  type    = number
  default = 7
}


# Object Lock can only be turned on when a bucket is created; never force-destroy
resource "aws_s3_bucket" "records" {
  bucket              = var.name
  object_lock_enabled = true
  force_destroy       = false
}


# Private by every switch S3 has
resource "aws_s3_bucket_ownership_controls" "records" {
  bucket = aws_s3_bucket.records.id
  rule { object_ownership = "BucketOwnerEnforced" }
}


# No public ACLs or policies, ever
resource "aws_s3_bucket_public_access_block" "records" {
  bucket                  = aws_s3_bucket.records.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}


# Object Lock needs versioning; it stays on
resource "aws_s3_bucket_versioning" "records" {
  bucket = aws_s3_bucket.records.id
  versioning_configuration { status = "Enabled" }
}


# Encrypted at rest with S3's own keys
resource "aws_s3_bucket_server_side_encryption_configuration" "records" {
  bucket = aws_s3_bucket.records.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}


# The default lock, for any copy written without its own date. Governance mode: only a person with the
# bypass permission (not the API) can shorten it, and only on purpose
resource "aws_s3_bucket_object_lock_configuration" "records" {
  bucket = aws_s3_bucket.records.id
  rule {
    default_retention {
      mode  = "GOVERNANCE"
      years = var.retain_years
    }
  }
  depends_on = [aws_s3_bucket_versioning.records]
}


# TLS only
resource "aws_s3_bucket_policy" "records" {
  bucket = aws_s3_bucket.records.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "TlsOnly"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.records.arn, "${aws_s3_bucket.records.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}


# The API writes copies here
output "bucket" { value = aws_s3_bucket.records.id }
output "bucket_arn" { value = aws_s3_bucket.records.arn }
