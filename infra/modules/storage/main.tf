# infra/modules/storage/main.tf - Client documents: one private bucket, one folder per organization
# (t/{tenantId}/...). Downloads are refused until GuardDuty tags an object clean.


# Inputs: the bucket name, the scanning switch, and the origin allowed to upload
variable "name" { type = string }
variable "malware_scan" {
  description = "Turn on GuardDuty Malware Protection for this bucket (about $0.09 per GB scanned)."
  type        = bool
  default     = false
}
variable "allowed_origin" { type = string }

# The permission ceiling on the scanner's role; dev has its own
variable "boundary" {
  type    = string
  default = "neon1-boundary-1neon"
}


# Client files outlive any apply; never force-destroy
resource "aws_s3_bucket" "docs" {
  bucket        = var.name
  force_destroy = false
}


# Private by every switch S3 has
resource "aws_s3_bucket_ownership_controls" "docs" {
  bucket = aws_s3_bucket.docs.id
  rule { object_ownership = "BucketOwnerEnforced" }
}


# No public ACLs or policies, ever
resource "aws_s3_bucket_public_access_block" "docs" {
  bucket                  = aws_s3_bucket.docs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}


# Versions protect against overwrites and deletes; old ones expire after 90 days
resource "aws_s3_bucket_versioning" "docs" {
  bucket = aws_s3_bucket.docs.id
  versioning_configuration { status = "Enabled" }
}


# SSE-S3 now; a customer-managed KMS key when a client asks for key control
resource "aws_s3_bucket_server_side_encryption_configuration" "docs" {
  bucket = aws_s3_bucket.docs.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}


# Expire old versions after 90 days and clean up abandoned uploads
resource "aws_s3_bucket_lifecycle_configuration" "docs" {
  bucket = aws_s3_bucket.docs.id
  rule {
    id     = "tidy"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration { noncurrent_days = 90 }
    abort_incomplete_multipart_upload { days_after_initiation = 2 }
  }
  depends_on = [aws_s3_bucket_versioning.docs]
}


# Browsers upload straight to S3 with presigned URLs from the API
resource "aws_s3_bucket_cors_configuration" "docs" {
  bucket = aws_s3_bucket.docs.id
  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = [var.allowed_origin]
    allowed_headers = ["content-type", "content-md5", "x-amz-*"]
    max_age_seconds = 600
  }
}


# TLS only, and with scanning on, no download of anything not tagged clean
resource "aws_s3_bucket_policy" "docs" {
  bucket = aws_s3_bucket.docs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [{
        Sid       = "TlsOnly"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.docs.arn, "${aws_s3_bucket.docs.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      }],
      var.malware_scan ? [{
        Sid       = "NoDownloadUntilClean"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.docs.arn}/t/*"
        Condition = {
          StringNotEquals = { "s3:ExistingObjectTag/GuardDutyMalwareScanStatus" = "NO_THREATS_FOUND" }
          ArnNotLike      = { "aws:PrincipalArn" = aws_iam_role.scan[0].arn }
        }
      }] : [],
    )
  })
}


# --- GuardDuty Malware Protection for S3 (optional until the first client uploads) ---


# The account ID for the boundary ARN
data "aws_caller_identity" "current" {}


# GuardDuty assumes this role to read new objects and tag the result
data "aws_iam_policy_document" "scan_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["malware-protection-plan.guardduty.amazonaws.com"]
    }
  }
}


# The scanning role and its policy exist only while scanning is on
resource "aws_iam_role" "scan" {
  count              = var.malware_scan ? 1 : 0
  name               = "${var.name}-malware-scan"
  assume_role_policy = data.aws_iam_policy_document.scan_trust.json
  # The ceiling set in neon1-aws-infrastructure; this stack can't create or change the role without it
  permissions_boundary = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/${var.boundary}"
}


# The access GuardDuty documents for S3 malware scanning, scoped to this bucket
resource "aws_iam_role_policy" "scan" {
  count = var.malware_scan ? 1 : 0
  role  = aws_iam_role.scan[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    # EventBridge rules GuardDuty manages, bucket notifications, object reads and tags, and its own test object
    Statement = [
      {
        Effect    = "Allow"
        Action    = ["events:PutRule", "events:DeleteRule", "events:PutTargets", "events:RemoveTargets", "events:DescribeRule"]
        Resource  = "arn:aws:events:*:*:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*"
        Condition = { StringLike = { "events:ManagedBy" = "malware-protection-plan.guardduty.amazonaws.com" } }
      },
      { Effect = "Allow", Action = ["s3:PutBucketNotification", "s3:GetBucketNotification", "s3:ListBucket"], Resource = aws_s3_bucket.docs.arn },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectTagging", "s3:GetObjectVersionTagging", "s3:PutObjectTagging", "s3:PutObjectVersionTagging"], Resource = "${aws_s3_bucket.docs.arn}/*" },
      { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.docs.arn}/malware-protection-resource-validation-object" },
    ]
  })
}


# Scan every new object and tag it with the result
resource "aws_guardduty_malware_protection_plan" "docs" {
  count = var.malware_scan ? 1 : 0
  role  = aws_iam_role.scan[0].arn
  protected_resource {
    s3_bucket { bucket_name = aws_s3_bucket.docs.id }
  }
  actions {
    tagging { status = "ENABLED" }
  }
  depends_on = [aws_iam_role_policy.scan]
}


# The API presigns uploads and downloads under t/{tenantId}/
output "bucket" { value = aws_s3_bucket.docs.id }
output "bucket_arn" { value = aws_s3_bucket.docs.arn }
