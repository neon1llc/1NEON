# infra/modules/sms/main.tf - Text messages from 1NEON: a US toll-free number for notifications and
# an opt-out list, so anyone who replies STOP never gets another text. AWS End User Messaging sends
# only after the number's toll-free registration is approved and the account leaves the SMS sandbox.


# Inputs: a name for the opt-out list
variable "name" { type = string }


# Replies of STOP (and its variants) land here, and AWS stops sending to those numbers by itself
resource "aws_pinpointsmsvoicev2_opt_out_list" "main" {
  name = var.name
}


# The toll-free number texts come from: transactional notices only, SMS only, kept safe from deletion
resource "aws_pinpointsmsvoicev2_phone_number" "notify" {
  iso_country_code              = "US"
  message_type                  = "TRANSACTIONAL"
  number_type                   = "TOLL_FREE"
  number_capabilities           = ["SMS"]
  opt_out_list_name             = aws_pinpointsmsvoicev2_opt_out_list.main.name
  self_managed_opt_outs_enabled = false
  deletion_protection_enabled   = true
}


# Outputs: the number's ARN (the API sends from it) and the number itself
output "number_arn" { value = aws_pinpointsmsvoicev2_phone_number.notify.arn }
output "number" { value = aws_pinpointsmsvoicev2_phone_number.notify.phone_number }
