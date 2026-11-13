# infra/envs/dev/outputs.tf - Names the dev deploy needs after an apply.


output "app_bucket" { value = module.hosting.bucket }
output "api_function" { value = module.api.api_function }
output "trigger_function" { value = module.api.trigger_function }
output "user_pool_id" { value = module.auth.user_pool_id }
