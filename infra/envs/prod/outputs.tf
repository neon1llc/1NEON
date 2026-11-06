# Names the deploy workflow and people need after an apply.
output "app_bucket" { value = module.hosting.bucket }
output "docs_bucket" { value = module.storage.bucket }
output "api_function" { value = module.api.api_function }
output "trigger_function" { value = module.api.trigger_function }
output "api_domain" { value = module.api.api_domain }
output "user_pool_id" { value = module.auth.user_pool_id }
output "client_id" { value = module.auth.client_id }
