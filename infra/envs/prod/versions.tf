# infra/envs/prod/versions.tf - Terraform and provider versions, the shared S3 state, and the
# AWS provider with default tags.


# State lives in the shared bucket with native S3 locking
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
    key          = "1neon/prod/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}


# CloudFront, ACM for Cognito's custom domain, and everything else: one region
provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "1neon"
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}
