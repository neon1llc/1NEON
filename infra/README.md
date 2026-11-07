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

## First-time setup

1. Apply `neon1-aws-infrastructure/github` by hand for the `github-1neon-terraform` and `github-1neon-deploy` roles, and set their ARNs here as the repository variables `AWS_TERRAFORM_ROLE_ARN` and `AWS_DEPLOY_ROLE_ARN`.
2. Apply this stack: `terraform -chdir=infra/envs/prod init && terraform -chdir=infra/envs/prod apply`.
3. Apply `neon1-aws-infrastructure/site`, which reads this stack's SSM parameters for the `/1NEON` behaviors.
4. Push to `main` to ship the functions and the app.
5. Confirm the alarm subscription email, and activate the `Project` cost allocation tag for the budget.

## Optional switches

- `google_client_id`, with the secret in SSM SecureString `/1neon/prod/google_client_secret`, turns on Google sign-in.
- `malware_scan = true` turns on GuardDuty scanning for the documents bucket. Turn it on before the first client upload.

## Notes

- Lambda code ships through `.github/workflows/deploy.yml`, not Terraform; Terraform ignores code changes on the functions.
- Cognito can't require MFA in a pool whose first factor is an email code, so the API requires a passkey or authenticator app for admin actions instead.
- Text messages (SMS codes) are left off: they need an origination number and US carrier registration first.
