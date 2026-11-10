# infra/envs/prod/variables.tf - Inputs for production. Defaults are the real values; secrets never
# appear here.


# The apex domain everything hangs off
variable "domain" {
  type    = string
  default = "neon1.tech"
}


# Resources owned elsewhere that this stack attaches to
variable "zone_id" {
  description = "Route 53 hosted zone for neon1.tech (owned outside this stack)."
  type        = string
  default     = "Z009089523ACQHD83TGQI"
}


variable "distribution_id" {
  description = "The neon1.tech CloudFront distribution (owned by neon1-aws-infrastructure/site)."
  type        = string
  default     = "EKL1R4AOR1VRG"
}


# Who runs the portal; the API reads this, nothing stores it
variable "operator_emails" {
  description = "Comma-separated emails with the neon1 operator role."
  type        = string
  default     = "pradeep@neon1.tech,neon1llc@gmail.com"
}


# Alarm and budget notices; must confirm the SNS subscription once
variable "alert_email" {
  type    = string
  default = "neon1llc@gmail.com"
}


# Optional switches, both off by default
variable "google_client_id" {
  description = "Google OAuth client ID. Empty leaves Google sign-in off."
  type        = string
  default     = ""
}


variable "malware_scan" {
  description = "GuardDuty Malware Protection on the documents bucket; uploads are open, so it stays on."
  type        = bool
  default     = true
}


# On (Pradeep, 2026-11-09). Carriers deliver only once the toll-free registration is approved; turning
# it off again hides texts in the profile and sends nothing
variable "texts_live" {
  description = "Offer text notices in the portal."
  type        = bool
  default     = true
}


# Neo for signed-in people. Off (empty) until the neon1-boundary-1neon boundary allows
# bedrock:InvokeModel on this profile and the model is enabled in Bedrock; then set the profile ID
variable "neo_model" {
  description = "Bedrock inference profile ID for Neo, or empty to keep Neo off."
  type        = string
  default     = ""
}

# Neo stops for the month once its estimated model spend reaches this many dollars
variable "neo_monthly_usd" {
  description = "Monthly ceiling for Neo's estimated model spend, in dollars."
  type        = number
  default     = 8
}
