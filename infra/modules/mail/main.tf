# infra/modules/mail/main.tf - Outbound email from 1NEON <noreply@notify.neon1.tech>: invites and
# sign-in codes. A subdomain keeps app mail separate from the people's mailboxes on the apex.


# Inputs: the sending subdomain, its zone, and a name for the configuration set
variable "domain" { type = string }
variable "zone_id" { type = string }
variable "name" { type = string }


# The sending domain, verified by Easy DKIM
resource "aws_sesv2_email_identity" "notify" {
  email_identity         = var.domain
  configuration_set_name = aws_sesv2_configuration_set.main.configuration_set_name
}


# Three DKIM CNAMEs, as SES issues them
resource "aws_route53_record" "dkim" {
  count   = 3
  zone_id = var.zone_id
  name    = "${aws_sesv2_email_identity.notify.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain}"
  type    = "CNAME"
  ttl     = 1800
  records = ["${aws_sesv2_email_identity.notify.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}


# Custom MAIL FROM so SPF aligns with the sending subdomain
resource "aws_sesv2_email_identity_mail_from_attributes" "notify" {
  email_identity         = aws_sesv2_email_identity.notify.email_identity
  mail_from_domain       = "bounce.${var.domain}"
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}


# MX and SPF on the MAIL FROM subdomain, as SES documents them
resource "aws_route53_record" "mail_from_mx" {
  zone_id = var.zone_id
  name    = "bounce.${var.domain}"
  type    = "MX"
  ttl     = 1800
  records = ["10 feedback-smtp.us-east-1.amazonses.com"]
}


# SPF allows only SES, and fails anything else
resource "aws_route53_record" "mail_from_spf" {
  zone_id = var.zone_id
  name    = "bounce.${var.domain}"
  type    = "TXT"
  ttl     = 1800
  records = ["v=spf1 include:amazonses.com -all"]
}


# DMARC for the subdomain only; the apex policy belongs with the people's mail
resource "aws_route53_record" "dmarc" {
  zone_id = var.zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  ttl     = 1800
  records = ["v=DMARC1; p=quarantine; adkim=s; aspf=r"]
}


# Bounces and complaints go to the account suppression list automatically
resource "aws_sesv2_configuration_set" "main" {
  configuration_set_name = var.name
  reputation_options { reputation_metrics_enabled = true }
  suppression_options { suppressed_reasons = ["BOUNCE", "COMPLAINT"] }
  sending_options { sending_enabled = true }
}


# Cognito and the API send through this identity and configuration set
output "identity_arn" { value = aws_sesv2_email_identity.notify.arn }
output "configuration_set" { value = aws_sesv2_configuration_set.main.configuration_set_name }
output "from" { value = "1NEON <noreply@${var.domain}>" }


# Cognito sends sign-in codes from this identity on the pool's behalf
data "aws_caller_identity" "current" {}


# Cognito may send only from this account's identity
resource "aws_sesv2_email_identity_policy" "cognito" {
  email_identity = aws_sesv2_email_identity.notify.email_identity
  policy_name    = "cognito-send"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cognito-idp.amazonaws.com" }
      Action    = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource  = aws_sesv2_email_identity.notify.arn
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}
