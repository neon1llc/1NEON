# Alarms that email Pradeep, and a budget for the portal's own spend.

variable "name" { type = string }
variable "alert_email" { type = string }
variable "api_function" { type = string }
variable "trigger_function" { type = string }
variable "api_id" { type = string }
variable "table_name" { type = string }
variable "monthly_budget_usd" {
  type    = number
  default = 10
}

# Alarm emails. The subscription must be confirmed once from the inbox.
resource "aws_sns_topic" "alerts" {
  name = "${var.name}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# Each alarm: metric, threshold over five minutes, and what it means in plain words.
locals {
  alarms = {
    api-errors = {
      namespace = "AWS/Lambda", metric = "Errors", stat = "Sum", threshold = 3
      dims      = { FunctionName = var.api_function }
      what      = "The 1NEON API threw errors."
    }
    api-throttles = {
      namespace = "AWS/Lambda", metric = "Throttles", stat = "Sum", threshold = 1
      dims      = { FunctionName = var.api_function }
      what      = "The 1NEON API was throttled."
    }
    trigger-errors = {
      namespace = "AWS/Lambda", metric = "Errors", stat = "Sum", threshold = 10
      dims      = { FunctionName = var.trigger_function }
      what      = "Many refused or failed sign-ups (uninvited attempts or a broken trigger)."
    }
    http-5xx = {
      namespace = "AWS/ApiGateway", metric = "5xx", stat = "Sum", threshold = 5
      dims      = { ApiId = var.api_id }
      what      = "The HTTP API returned server errors."
    }
    table-throttles = {
      namespace = "AWS/DynamoDB", metric = "ThrottledRequests", stat = "Sum", threshold = 1
      dims      = { TableName = var.table_name }
      what      = "DynamoDB throttled requests."
    }
  }
}

# Alarm on breach and on recovery; quiet periods count as fine.
resource "aws_cloudwatch_metric_alarm" "this" {
  for_each            = local.alarms
  alarm_name          = "${var.name}-${each.key}"
  alarm_description   = each.value.what
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.stat
  dimensions          = each.value.dims
  period              = 300
  evaluation_periods  = 1
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# Counts only resources tagged Project=1neon (activate that cost allocation tag once in Billing).
resource "aws_budgets_budget" "portal" {
  name         = var.name
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Project$1neon"]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}

output "topic_arn" { value = aws_sns_topic.alerts.arn }
