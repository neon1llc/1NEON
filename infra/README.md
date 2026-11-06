# 1NEON infrastructure

Production runs at `neon1.tech/1NEON` in us-east-1. This folder owns everything behind the edge: the app and documents buckets, the DynamoDB table, Cognito, the API, SES, and alarms. The neon1.tech CloudFront distribution and its `/1NEON` behaviors live in `neon1-aws-infrastructure/site` and read two SSM parameters this stack publishes.

```
modules/
  hosting/        SPA bucket, readable only by the neon1.tech distribution
  data/           single DynamoDB table (PITR, TTL, deletion protection)
  storage/        client documents bucket, optional GuardDuty malware scanning
  mail/           SES on notify.neon1.tech (DKIM, MAIL FROM, DMARC)
  auth/           Cognito Essentials: email codes, passkeys, optional password and TOTP, Google
  api/            HTTP API, API and pre sign-up Lambda functions, least-privilege roles
  observability/  alarms to email, monthly budget
envs/prod/        state at s3://neon1-tfstate/1neon/prod/terraform.tfstate
```

## First-time setup (once, in this order)

1. **GitHub roles.** Apply `neon1-aws-infrastructure/github` by hand. It adds `github-1neon-terraform` and `github-1neon-deploy`. Set their ARNs as repository variables `AWS_TERRAFORM_ROLE_ARN` and `AWS_DEPLOY_ROLE_ARN` here. Until then the terraform and deploy workflows skip themselves.
2. **This stack.** `terraform -chdir=infra/envs/prod init && terraform -chdir=infra/envs/prod apply`. Functions start with placeholders: the API answers 503 and the trigger admits only invites.
3. **Edge.** Merge the `/1NEON` change in `neon1-aws-infrastructure` so its pipeline applies `site`. It reads `/1neon/prod/app_bucket_domain` and `/1neon/prod/api_domain`.
4. **Code.** Run the deploy workflow (or push to main). It ships both functions and the web app, then checks `https://neon1.tech/1NEON/api/health`.
5. **Email.** Ask AWS to move SES out of the sandbox (Account dashboard → Request production access); until then mail reaches verified addresses only. Confirm the alarm subscription email.
6. **Billing.** Activate the `Project` cost allocation tag so the budget counts 1NEON's spend.

## Optional switches

- `google_client_id`, with the secret in SSM SecureString `/1neon/prod/google_client_secret`, turns on Google sign-in.
- `malware_scan = true` turns on GuardDuty scanning for the documents bucket. Turn it on before the first client upload.

## Notes

- Lambda code ships through `.github/workflows/deploy.yml`, not Terraform; Terraform ignores code changes on the functions.
- Cognito can't require MFA in a pool whose first factor is an email code, so the API requires a passkey or authenticator app for admin actions instead.
- Text messages (SMS codes) are left off: they need an origination number and US carrier registration first.
