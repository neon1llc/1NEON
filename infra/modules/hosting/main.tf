# infra/modules/hosting/main.tf - The SPA's private bucket. The neon1.tech distribution (owned by
# neon1-aws-infrastructure/site) reads it through Origin Access Control; objects live under the
# 1NEON/ prefix.


# Inputs: the bucket name and the distribution allowed to read it
variable "name" { type = string }
variable "distribution_arn" { type = string }


# Never force-destroy: a bad apply must not take the app down with its files
resource "aws_s3_bucket" "app" {
  bucket        = var.name
  force_destroy = false
}


# Private by every switch S3 has
resource "aws_s3_bucket_ownership_controls" "app" {
  bucket = aws_s3_bucket.app.id
  rule { object_ownership = "BucketOwnerEnforced" }
}


# No public ACLs or policies, ever
resource "aws_s3_bucket_public_access_block" "app" {
  bucket                  = aws_s3_bucket.app.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}


# Versions let a bad deploy roll back; lifecycle keeps only recent ones
resource "aws_s3_bucket_versioning" "app" {
  bucket = aws_s3_bucket.app.id
  versioning_configuration { status = "Enabled" }
}


# Keep five old versions for up to 30 days, enough to roll back a deploy
resource "aws_s3_bucket_lifecycle_configuration" "app" {
  bucket = aws_s3_bucket.app.id
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days           = 30
      newer_noncurrent_versions = 5
    }
  }
  depends_on = [aws_s3_bucket_versioning.app]
}


# Only the neon1.tech distribution may read, and only over TLS
resource "aws_s3_bucket_policy" "app" {
  bucket = aws_s3_bucket.app.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontOAC"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.app.arn}/*"
        Condition = { StringEquals = { "AWS:SourceArn" = var.distribution_arn } }
      },
      {
        Sid       = "TlsOnly"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.app.arn, "${aws_s3_bucket.app.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  })
}


# The deploy workflow syncs here; the edge stack reads the domain from SSM
output "bucket" { value = aws_s3_bucket.app.id }
output "bucket_arn" { value = aws_s3_bucket.app.arn }
output "bucket_domain" { value = aws_s3_bucket.app.bucket_regional_domain_name }
