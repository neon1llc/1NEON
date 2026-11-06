# The API: one Lambda behind an HTTP API, reached through CloudFront at /1NEON/api/*.
# Terraform creates the functions with a placeholder; the deploy workflow ships the real code.

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
variable "log_retention_days" {
  type    = number
  default = 90
}

# Account and region, for ARNs that can't come from another resource.
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# Placeholders until the first deploy. The trigger lets only our own invites through.
data "archive_file" "api_placeholder" {
  type                    = "zip"
  output_path             = "${path.module}/.placeholder-api.zip"
  source_content_filename = "index.mjs"
  source_content          = "export const handler = async () => ({ statusCode: 503, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'starting', message: '1NEON is starting. Try again in a minute.' }) });\n"
}

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

# One role per function, each with only what that function does.
resource "aws_iam_role" "api" {
  name               = "${var.name}-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role" "trigger" {
  name               = "${var.name}-auth-trigger"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

# The API: its table, client files under t/, invites in Cognito, and mail from our identity.
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
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:GetObjectTagging"]
    resources = ["${var.docs_bucket_arn}/t/*"]
  }
  statement {
    sid       = "Directory"
    actions   = ["cognito-idp:AdminGetUser", "cognito-idp:AdminCreateUser", "cognito-idp:AdminDisableUser", "cognito-idp:AdminEnableUser", "cognito-idp:AdminUserGlobalSignOut"]
    resources = [var.user_pool_arn]
  }
  statement {
    sid       = "Mail"
    actions   = ["ses:SendEmail"]
    resources = [var.ses_identity_arn, "arn:aws:ses:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:configuration-set/${var.ses_configuration_set}"]
  }
}

resource "aws_iam_role_policy" "api" {
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

# The trigger only looks up whether an email was invited.
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

resource "aws_iam_role_policy" "trigger" {
  role   = aws_iam_role.trigger.id
  policy = data.aws_iam_policy_document.trigger.json
}

# --- Functions ---

# Log groups are declared so retention is set; the default keeps logs forever.
resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${var.name}-api"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "trigger" {
  name              = "/aws/lambda/${var.name}-auth-trigger"
  retention_in_days = var.log_retention_days
}

# 1 GB arm64: faster cold starts for pennies at this traffic.
resource "aws_lambda_function" "api" {
  function_name = "${var.name}-api"
  role          = aws_iam_role.api.arn
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  memory_size   = 1024
  timeout       = 15
  filename      = data.archive_file.api_placeholder.output_path

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
      OPERATOR_EMAILS                     = var.operator_emails
      NODE_OPTIONS                        = "--enable-source-maps"
      AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
    }
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.api.name
  }

  # Code ships through the deploy workflow, not Terraform.
  lifecycle { ignore_changes = [filename, source_code_hash] }
}

# Cognito waits on this during sign-up, so keep it small and quick.
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

# HTTP API: the cheapest API Gateway, enough for a Lambda proxy.
resource "aws_apigatewayv2_api" "main" {
  name          = var.name
  protocol_type = "HTTP"
  # Only CloudFront should call this; the execute-api URL serves no cookies and no CORS.
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 15000
}

# The path keeps its /1NEON/api prefix all the way to Hono.
resource "aws_apigatewayv2_route" "api" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "ANY /1NEON/api/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

# One JSON line per request, for incident review.
resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${var.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  # A cheap abuse limit until WAF is worth turning on.
  default_route_settings {
    throttling_rate_limit  = 50
    throttling_burst_limit = 100
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestId = "$context.requestId", ip = "$context.identity.sourceIp", method = "$context.httpMethod",
      path      = "$context.path", status = "$context.status", latency = "$context.responseLatency", error = "$context.integrationErrorMessage"
    })
  }
}

# Let this API, and only this API, invoke the function.
resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# The edge stack reads the API domain from SSM; deploys need the function names.
output "api_domain" { value = replace(aws_apigatewayv2_api.main.api_endpoint, "https://", "") }
output "api_function" { value = aws_lambda_function.api.function_name }
output "trigger_function" { value = aws_lambda_function.trigger.function_name }
output "trigger_arn" { value = aws_lambda_function.trigger.arn }
output "api_function_name" { value = aws_lambda_function.api.function_name }
