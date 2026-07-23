# Terraform

Provision a VM (AWS EC2 or Vultr) that runs HarborFM via user-data (PM2, nginx, optional WebRTC and Let's Encrypt).

## Prerequisites

- **Terraform** installed (see [QUICKSTART](https://github.com/LoganRickert/harborfm/blob/main/infrastructure/terraform/QUICKSTART.md) for macOS, Debian, and CentOS)
- **AWS:** `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (or `aws configure`)
- **Vultr:** `VULTR_API_KEY` in `.env` (copy from `infrastructure/terraform/.env.example`)

## AWS (EC2)

1. `cd infrastructure/terraform/aws`
2. `cp terraform.tfvars.example terraform.tfvars`
3. Edit `terraform.tfvars`: `deploy_type`, `ami_id` (Debian 12 for your region), `domain`, `admin_email`, `admin_password`, etc.
4. `./run.sh init` then `./run.sh apply`
5. Use the **url** output to open the app. If you set `admin_email` and `admin_password`, the admin is created on first boot.

**AMI lookup (Debian 12):** Owner `136693071363`. Example for `us-east-2`:

```bash
aws ec2 describe-images --region us-east-2 --owners 136693071363 \
  --filters "Name=name,Values=debian-12-*" "Name=state,Values=available" \
  --query "sort_by(Images, &CreationDate)[-1].ImageId" --output text
```

## Vultr

1. `cd infrastructure/terraform/vultr`
2. `cp terraform.tfvars.example terraform.tfvars`
3. Edit `terraform.tfvars`: `deploy_type`, `region`, `os_id`, `plan`, `domain`, etc.
4. `./run.sh init` then `./run.sh apply`

**OS IDs:** list with Vultr's OS API. Common examples include Debian 12 `2136` and Ubuntu 22 `1743`.

## Full Reference

- [infrastructure/terraform/README.md](https://github.com/LoganRickert/harborfm/blob/main/infrastructure/terraform/README.md) - variables, optional persistent data volume, multi-environment
- [infrastructure/terraform/QUICKSTART.md](https://github.com/LoganRickert/harborfm/blob/main/infrastructure/terraform/QUICKSTART.md) - step-by-step install and first apply

## See Also

- [Docker Compose](/docs/installation/docker-compose/) for install.sh-based hosts
- [Environment Variables](/docs/installation/environment-variables/)
- [Usage: Deployment](/docs/usage/deployment/)
