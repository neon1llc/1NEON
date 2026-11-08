# infra/envs/prod/main.tf - 1NEON production: neon1.tech/1NEON. The edge (CloudFront behaviors and
# functions) lives in neon1-aws-infrastructure/site and reads the SSM parameters published at the
# bottom of this file.


# One name prefix and the public, sign-in, and mail hostnames
locals {
  name        = "1neon-prod"
  public_url  = "https://${var.domain}"
  auth_domain = "auth.${var.domain}"
  mail_domain = "notify.${var.domain}"
}


# The live neon1.tech distribution; its ARN scopes the app bucket policy
data "aws_cloudfront_distribution" "site" {
  id = var.distribution_id
}


# The existing apex + wildcard certificate covers auth.neon1.tech
data "aws_acm_certificate" "site" {
  domain      = var.domain
  statuses    = ["ISSUED"]
  most_recent = true
}


# The SPA's bucket, read by the distribution through OAC
module "hosting" {
  source           = "../../modules/hosting"
  name             = "neon1-1neon-app-prod"
  distribution_arn = data.aws_cloudfront_distribution.site.arn
}


# The single DynamoDB table
module "data" {
  source = "../../modules/data"
  name   = local.name
}


# Client documents, one folder per organization
module "storage" {
  source         = "../../modules/storage"
  name           = "neon1-1neon-docs-prod"
  allowed_origin = local.public_url
  malware_scan   = var.malware_scan
}


# SES sending from notify.neon1.tech
module "mail" {
  source  = "../../modules/mail"
  name    = local.name
  domain  = local.mail_domain
  zone_id = var.zone_id
}


# The API and the Cognito trigger, wired to everything above
module "api" {
  source                = "../../modules/api"
  name                  = local.name
  env                   = "prod"
  table_arn             = module.data.arn
  table_name            = module.data.name
  docs_bucket           = module.storage.bucket
  docs_bucket_arn       = module.storage.bucket_arn
  public_url            = local.public_url
  auth_domain           = local.auth_domain
  mail_from             = module.mail.from
  ses_identity_arn      = module.mail.identity_arn
  ses_configuration_set = module.mail.configuration_set
  operator_emails       = var.operator_emails
  user_pool_id          = module.auth.user_pool_id
  user_pool_arn         = module.auth.user_pool_arn
  client_id             = module.auth.client_id
  sms_number_arn        = module.sms.number_arn
}


# Text messages: the toll-free number and its opt-out list
module "sms" {
  source = "../../modules/sms"
  name   = local.name
}


# Cognito: invite-only sign-in on auth.neon1.tech
module "auth" {
  source          = "../../modules/auth"
  name            = local.name
  auth_domain     = local.auth_domain
  zone_id         = var.zone_id
  certificate_arn = data.aws_acm_certificate.site.arn
  public_url      = local.public_url
  # Passkeys bound to neon1.tech work on every subdomain, so a later move off auth.neon1.tech keeps them
  passkey_rp_id                  = var.domain
  ses_identity_arn               = module.mail.identity_arn
  ses_configuration_set          = module.mail.configuration_set
  mail_from                      = module.mail.from
  pre_sign_up_arn                = module.api.trigger_arn
  google_client_id               = var.google_client_id
  google_client_secret_parameter = "/1neon/prod/google_client_secret"
}


# Alarms to email, and the monthly budget
module "observability" {
  source           = "../../modules/observability"
  name             = local.name
  alert_email      = var.alert_email
  api_function     = module.api.api_function
  trigger_function = module.api.trigger_function
  api_id           = split(".", module.api.api_domain)[0]
  table_name       = module.data.name
}


# --- Values the edge stack reads (no remote-state coupling) ---


# Plain strings under /1neon/prod/, read by neon1-aws-infrastructure/site
resource "aws_ssm_parameter" "edge" {
  for_each = {
    app_bucket_domain = module.hosting.bucket_domain
    api_domain        = module.api.api_domain
  }
  name  = "/1neon/prod/${each.key}"
  type  = "String"
  value = each.value
}
