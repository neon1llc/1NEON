# infra/envs/dev/variables.tf - Inputs for the dev backend behind dev.neon1.tech/1NEON.


variable "domain" {
  type    = string
  default = "neon1.tech"
}


variable "zone_id" {
  description = "Route 53 hosted zone for neon1.tech (owned outside this stack)."
  type        = string
  default     = "Z009089523ACQHD83TGQI"
}


# Who runs the dev portal: the same people as production
variable "operator_emails" {
  description = "Comma-separated emails with the neon1 operator role."
  type        = string
  default     = "pradeep@neon1.tech,neon1llc@gmail.com"
}


# Neo stays off in dev unless a model is named here, as in production
variable "neo_model" {
  description = "Bedrock inference profile ID for Neo, or empty to keep Neo off."
  type        = string
  default     = ""
}
