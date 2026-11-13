# infra/envs/dev/versions.tf - Terraform and provider versions, its own state, and the AWS provider
# with default tags. Environment=dev is what scopes the dev functions' user-pool access
# (neon1-boundary-1neon-dev) and what the dev budget counts.


terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  backend "s3" {
    bucket       = "neon1-tfstate"
    key          = "1neon/dev/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}


provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "1neon"
      Environment = "dev"
      ManagedBy   = "terraform"
    }
  }
}
