# infra/modules/auth/main.tf - Cognito user pool (Essentials): email codes, passkeys, optional
# password, optional TOTP, Google when configured. Invite only. Managed Login on auth.neon1.tech.


# Inputs: hostnames, certificate, passkey domain, mail, the trigger, and optional Google
variable "name" { type = string }
variable "auth_domain" { type = string }
variable "zone_id" { type = string }
variable "certificate_arn" { type = string }
variable "public_url" { type = string }
variable "passkey_rp_id" { type = string }
variable "ses_identity_arn" { type = string }
variable "ses_configuration_set" { type = string }
variable "mail_from" { type = string }
variable "pre_sign_up_arn" { type = string }
variable "google_client_id" {
  type    = string
  default = ""
}
variable "google_client_secret_parameter" {
  description = "SSM SecureString name holding the Google OAuth client secret."
  type        = string
  default     = ""
}


# Essentials tier: free to 10,000 monthly users and required for passwordless and passkeys
resource "aws_cognito_user_pool" "main" {
  name                     = var.name
  user_pool_tier           = "ESSENTIALS"
  deletion_protection      = "ACTIVE"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Email is the username, compared case-insensitively
  username_configuration { case_sensitive = false }

  # Passwordless first: an email code or a passkey; a password stays optional
  sign_in_policy { allowed_first_auth_factors = ["EMAIL_OTP", "WEB_AUTHN", "PASSWORD"] }

  # Passkeys belong to neon1.tech, not just the sign-in host
  web_authn_configuration {
    relying_party_id  = var.passkey_rp_id
    user_verification = "preferred"
  }

  # With code-first sign-in Cognito can't require MFA; the API requires strong sign-in for admin actions
  mfa_configuration = "OPTIONAL"
  software_token_mfa_configuration { enabled = true }

  # Invite only: nobody signs themselves up
  admin_create_user_config { allow_admin_create_user_only = true }

  # Passwords are optional; when used, length matters more than character rules
  password_policy {
    minimum_length                   = 12
    require_lowercase                = false
    require_uppercase                = false
    require_numbers                  = false
    require_symbols                  = false
    temporary_password_validity_days = 7
    password_history_size            = 5
  }

  # Recovery only through the verified email
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Codes and notices go out through our SES domain, not Cognito's capped default mailer
  email_configuration {
    email_sending_account = "DEVELOPER"
    source_arn            = var.ses_identity_arn
    from_email_address    = var.mail_from
    configuration_set     = var.ses_configuration_set
  }

  # One trigger function: refuses first-time Google sign-ins without an invite, and brands code emails
  lambda_config {
    pre_sign_up    = var.pre_sign_up_arn
    custom_message = var.pre_sign_up_arn
  }

  # An email change takes effect only after the new address is verified
  user_attribute_update_settings { attributes_require_verification_before_update = ["email"] }
}


# Google sign-in, only when a client ID is configured; the secret stays in SSM
resource "aws_cognito_identity_provider" "google" {
  count         = var.google_client_id == "" ? 0 : 1
  user_pool_id  = aws_cognito_user_pool.main.id
  provider_name = "Google"
  provider_type = "Google"
  provider_details = {
    client_id        = var.google_client_id
    client_secret    = data.aws_ssm_parameter.google_secret[0].value
    authorize_scopes = "openid email profile"
  }
  attribute_mapping = {
    email          = "email"
    email_verified = "email_verified"
    name           = "name"
  }
}


# Read only when Google sign-in is on
data "aws_ssm_parameter" "google_secret" {
  count = var.google_client_id == "" ? 0 : 1
  name  = var.google_client_secret_parameter
}


# Public client: authorization code + PKCE, exchanged by the API; tokens never reach JavaScript
resource "aws_cognito_user_pool_client" "web" {
  name            = "${var.name}-web"
  user_pool_id    = aws_cognito_user_pool.main.id
  generate_secret = false
  # Code flow only, with the scopes the API needs to read the profile and passkeys
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile", "aws.cognito.signin.user.admin"]
  callback_urls                        = ["${var.public_url}/1NEON/api/auth/callback"]
  logout_urls                          = ["${var.public_url}/1NEON/"]
  supported_identity_providers         = concat(["COGNITO"], aws_cognito_identity_provider.google[*].provider_name)
  explicit_auth_flows                  = ["ALLOW_USER_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  # Short-lived access and ID tokens; the refresh token keeps people signed in for 30 days
  access_token_validity  = 15
  id_token_validity      = 15
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}


# Managed Login v2 on auth.neon1.tech, using the existing wildcard certificate
resource "aws_cognito_user_pool_domain" "main" {
  domain                = var.auth_domain
  user_pool_id          = aws_cognito_user_pool.main.id
  certificate_arn       = var.certificate_arn
  managed_login_version = 2
}


# Default Managed Login styling for now; neon1 branding is a later pass
resource "aws_cognito_managed_login_branding" "web" {
  user_pool_id                = aws_cognito_user_pool.main.id
  client_id                   = aws_cognito_user_pool_client.web.id
  use_cognito_provided_values = true
}


# auth.neon1.tech points at Cognito's own CloudFront distribution
resource "aws_route53_record" "auth" {
  for_each = toset(["A", "AAAA"])
  zone_id  = var.zone_id
  name     = var.auth_domain
  type     = each.key
  alias {
    name                   = aws_cognito_user_pool_domain.main.cloudfront_distribution
    zone_id                = aws_cognito_user_pool_domain.main.cloudfront_distribution_zone_id
    evaluate_target_health = false
  }
}


# The API needs these to verify tokens and run the sign-in flow
output "user_pool_id" { value = aws_cognito_user_pool.main.id }
output "user_pool_arn" { value = aws_cognito_user_pool.main.arn }
output "client_id" { value = aws_cognito_user_pool_client.web.id }


# Let this pool, and only this pool, call the pre sign-up function
resource "aws_lambda_permission" "pre_sign_up" {
  statement_id  = "AllowCognitoPreSignUp"
  action        = "lambda:InvokeFunction"
  function_name = var.pre_sign_up_arn
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}
