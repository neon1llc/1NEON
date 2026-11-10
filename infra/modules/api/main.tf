# infra/modules/api/main.tf - The API: one Lambda behind an HTTP API, reached through CloudFront at
# /1NEON/api/*. Terraform creates the functions with a placeholder; the deploy workflow ships the
# real code.


# Inputs: names, the table, the documents bucket, mail, and the user pool
variable "name" { type = string }
variable "env" { type = string }
variable "table_arn" { type = string }
variable "table_name" { type = string }
variable "docs_bucket_arn" { type = string }
variable "docs_bucket" { type = string }
variable "public_url" { type = string }
variable "auth_domain" { type = string }
variable "mail_from" { type = string }
variable "ses_identity_arn" { type = string }
variable "ses_configuration_set" { type = string }
variable "operator_emails" { type = string }
variable "user_pool_id" { type = string }
variable "user_pool_arn" { type = string }
variable "client_id" { type = string }
# The toll-free number texts come from (its ARN)
variable "sms_number_arn" { type = string }
# Whether the API offers texts. Off until the number's toll-free registration is approved, so the
# profile says texts aren't available instead of sending codes carriers will drop
variable "texts_live" {
  type    = bool
  default = false
}
# Neo's model on Bedrock (an inference profile ID, such as us.anthropic.claude-sonnet-5-5). Empty keeps
# Neo off: no permission, no setting, and the panel says Neo isn't available
variable "neo_model" {
  type    = string
  default = ""
}
# The month's ceiling for Neo's estimated model spend, in dollars
variable "neo_monthly_usd" {
  type    = number
  default = 8
}
variable "log_retention_days" {
  type    = number
  default = 90
}


# Account and region, for ARNs that can't come from another resource
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}


# Placeholders until the first deploy. The trigger lets only our own invites through
data "archive_file" "api_placeholder" {
  type                    = "zip"
  output_path             = "${path.module}/.placeholder-api.zip"
  source_content_filename = "index.mjs"
  source_content          = "export const handler = async () => ({ statusCode: 503, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'starting', message: '1NEON is starting. Try again in a minute.' }) });\n"
}


# Admits only AdminCreateUser, so nobody self-registers before real code ships
data "archive_file" "trigger_placeholder" {
  type                    = "zip"
  output_path             = "${path.module}/.placeholder-trigger.zip"
  source_content_filename = "index.mjs"
  source_content          = "export const handler = async (e) => { if (e.triggerSource === 'PreSignUp_AdminCreateUser') return e; throw new Error('Not invited'); };\n"
}


# --- Roles ---


data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}


# One role per function, each with only what that function does
resource "aws_iam_role" "api" {
  name               = "${var.name}-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
  # The ceiling set in neon1-aws-infrastructure; this stack can't create or change the role without it
  permissions_boundary = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/neon1-boundary-1neon"
}


# The pre sign-up trigger's role
resource "aws_iam_role" "trigger" {
  name               = "${var.name}-auth-trigger"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
  # The ceiling set in neon1-aws-infrastructure; this stack can't create or change the role without it
  permissions_boundary = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/neon1-boundary-1neon"
}


# The API: its table, client files under t/, invites in Cognito, and mail from our identity
data "aws_iam_policy_document" "api" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]
  }
  statement {
    sid       = "Table"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:BatchGetItem", "dynamodb:ConditionCheckItem"]
    resources = [var.table_arn, "${var.table_arn}/index/*"]
  }
  statement {
    sid       = "Docs"
    actions   = ["s3:GetObject", "s3:GetObjectAttributes", "s3:PutObject", "s3:DeleteObject", "s3:GetObjectTagging"]
    resources = ["${var.docs_bucket_arn}/t/*"]
  }
  statement {
    sid       = "Directory"
    actions   = ["cognito-idp:AdminGetUser", "cognito-idp:AdminCreateUser", "cognito-idp:AdminDisableUser", "cognito-idp:AdminEnableUser", "cognito-idp:AdminUserGlobalSignOut"]
    resources = [var.user_pool_arn]
  }
  statement {
    sid       = "Texts"
    actions   = ["sms-voice:SendTextMessage"]
    resources = [var.sms_number_arn]
  }
  statement {
    sid       = "Mail"
    actions   = ["ses:SendEmail"]
    resources = [var.ses_identity_arn, "arn:aws:ses:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:configuration-set/${var.ses_configuration_set}"]
  }
  # Neo: one model through one cross-region inference profile, which routes to the model in any US region
  dynamic "statement" {
    for_each = var.neo_model == "" ? [] : [var.neo_model]
    content {
      sid     = "Neo"
      actions = ["bedrock:InvokeModel"]
      resources = [
        "arn:aws:bedrock:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:inference-profile/${statement.value}",
        "arn:aws:bedrock:us-*::foundation-model/${replace(statement.value, "/^(us|global)\\./", "")}",
      ]
    }
  }
}


# Attach the API policy to the API role
resource "aws_iam_role_policy" "api" {
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}


# The trigger only looks up whether an email was invited
data "aws_iam_policy_document" "trigger" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.trigger.arn}:*"]
  }
  statement {
    actions   = ["dynamodb:GetItem"]
    resources = [var.table_arn]
  }
}


# Attach the trigger policy to the trigger role
resource "aws_iam_role_policy" "trigger" {
  role   = aws_iam_role.trigger.id
  policy = data.aws_iam_policy_document.trigger.json
}


# --- Functions ---


# Log groups are declared so retention is set; the default keeps logs forever
resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${var.name}-api"
  retention_in_days = var.log_retention_days
}


# The trigger's logs, kept as long as the API's
resource "aws_cloudwatch_log_group" "trigger" {
  name              = "/aws/lambda/${var.name}-auth-trigger"
  retention_in_days = var.log_retention_days
}


# 1 GB arm64: faster cold starts for pennies at this traffic
resource "aws_lambda_function" "api" {
  function_name = "${var.name}-api"
  role          = aws_iam_role.api.arn
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  memory_size   = 1024
  # Room for a Neo question (24 seconds at most) inside the HTTP API's 30-second ceiling
  timeout  = 28
  filename = data.archive_file.api_placeholder.output_path

  # Everything config.ts reads; connection reuse keeps SDK calls fast between invocations
  environment {
    variables = {
      APP_ENV                             = var.env
      TABLE_NAME                          = var.table_name
      DOCS_BUCKET                         = var.docs_bucket
      USER_POOL_ID                        = var.user_pool_id
      USER_POOL_CLIENT_ID                 = var.client_id
      AUTH_DOMAIN                         = var.auth_domain
      PUBLIC_URL                          = var.public_url
      MAIL_FROM                           = var.mail_from
      SMS_FROM                            = var.texts_live ? var.sms_number_arn : ""
      OPERATOR_EMAILS                     = var.operator_emails
      NEO_MODEL                           = var.neo_model
      NEO_MONTHLY_USD                     = tostring(var.neo_monthly_usd)
      NODE_OPTIONS                        = "--enable-source-maps"
      AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
    }
  }

  # JSON logs into the declared group, so retention applies
  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.api.name
  }

  # Code ships through the deploy workflow, not Terraform
  lifecycle { ignore_changes = [filename, source_code_hash] }
}


# Cognito waits on this during sign-up, so keep it small and quick
resource "aws_lambda_function" "trigger" {
  function_name = "${var.name}-auth-trigger"
  role          = aws_iam_role.trigger.arn
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  memory_size   = 512
  timeout       = 5
  filename      = data.archive_file.trigger_placeholder.output_path

  environment {
    variables = { TABLE_NAME = var.table_name }
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.trigger.name
  }

  lifecycle { ignore_changes = [filename, source_code_hash] }
}


# --- HTTP API ---


# HTTP API: the cheapest API Gateway, enough for a Lambda proxy
resource "aws_apigatewayv2_api" "main" {
  name          = var.name
  protocol_type = "HTTP"
  # Only CloudFront should call this; the execute-api URL serves no cookies and no CORS
}


# Lambda proxy with the 2.0 payload Hono's adapter expects; timeout matches the function
resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 28000
}


# The path keeps its /1NEON/api prefix all the way to Hono
resource "aws_apigatewayv2_route" "api" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "ANY /1NEON/api/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}


# One JSON line per request, for incident review
resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${var.name}"
  retention_in_days = var.log_retention_days
}


# The default stage deploys every change on its own
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  # A cheap abuse limit until WAF is worth turning on
  default_route_settings {
    throttling_rate_limit  = 50
    throttling_burst_limit = 100
  }

  # Request ID, caller, route, status, latency, and integration errors; no bodies or cookies
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestId = "$context.requestId", ip = "$context.identity.sourceIp", method = "$context.httpMethod",
      path      = "$context.path", status = "$context.status", latency = "$context.responseLatency", error = "$context.integrationErrorMessage"
    })
  }
}


# Let this API, and only this API, invoke the function
resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}


# --- Outbox worker ---


# Once a minute the same function sends what the outbox holds (emails, texts, invitations). Requests
# only queue messages, so a slow provider never holds one up. Scheduled rules cost nothing
resource "aws_cloudwatch_event_rule" "outbox" {
  name                = "${var.name}-outbox"
  description         = "Send queued 1NEON notifications and invitations"
  schedule_expression = "rate(1 minute)"
}


# The schedule's target is the API function; the handler tells the two callers apart by source
resource "aws_cloudwatch_event_target" "outbox" {
  rule = aws_cloudwatch_event_rule.outbox.name
  arn  = aws_lambda_function.api.arn
  # A missed minute is covered by the next one, so no retries of a stale pass
  retry_policy {
    maximum_event_age_in_seconds = 60
    maximum_retry_attempts       = 0
  }
}


# Only this rule may invoke the function from EventBridge
resource "aws_lambda_permission" "outbox" {
  statement_id  = "AllowOutboxSchedule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.outbox.arn
}


# The edge stack reads the API domain from SSM; deploys need the function names
output "api_domain" { value = replace(aws_apigatewayv2_api.main.api_endpoint, "https://", "") }
output "api_function" { value = aws_lambda_function.api.function_name }
output "trigger_function" { value = aws_lambda_function.trigger.function_name }
output "trigger_arn" { value = aws_lambda_function.trigger.arn }
output "api_function_name" { value = aws_lambda_function.api.function_name }
