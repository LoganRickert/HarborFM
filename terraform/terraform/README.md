# Harbor FM Terraform

Deploy Harbor FM by creating a VM with user-data (AWS or Vultr).

**First time?** See [QUICKSTART.md](QUICKSTART.md) for a step-by-step walkthrough.

For Kubernetes, use the Helm chart directly - see [../helm/harborfm/README.md](../helm/harborfm/README.md).

Notes: I am not a terraform expert so just be glad if any of this even kind of works.

## Layout

- **`aws/`** – EC2 instance + security group; uses shared modules for user-data, Cloudflare DNS, and outputs.
- **`vultr/`** – Vultr instance; uses shared modules for user-data, Cloudflare DNS, and outputs.
- **`common/`** – Shared variables (`variables-shared.tf`) used by all providers via symlinks.
- **`modules/`** – Shared Terraform modules:
  - `harborfm-userdata` – builds user-data script from variables
  - `harborfm-cloudflare` – creates Cloudflare A records
  - `harborfm-outputs` – shared output formatting (url, setup_url)

User-data scripts live in **`../user-data/`** (see [user-data README](../user-data/README.md)).

---

## AWS (`aws/`)

Creates an EC2 instance and security group. The instance runs the chosen user-data script on first boot.

### Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `os` | no | `debian-12` | One of: `debian-11`, `debian-12`, `debian-13`, `ubuntu-22`, `ubuntu-24`, `ubuntu-25`, `centos-9`, `centos-10`. Must match your AMI. |
| `deploy_type` | yes | - | One of: `nginx`, `caddy`, `pm2`. |
| `ami_id` | yes | - | AMI ID (must match `os`; e.g. Debian 12 for `debian-12`-look up for your region). |
| `instance_type` | no | `t3.small` | EC2 instance type. **Note:** t3.micro runs out of RAM with PM2; use at least t3.small. |
| `root_volume_size` | no | `8` | Root EBS volume size in GB (OS only). |
| `data_volume_size` | no | `20` | Persistent data EBS volume in GB (data, secrets, webrtc). When > 0, a second volume is attached and survives `terraform destroy` so a new instance can reattach; set to `0` to disable. See [Deleting the data EBS](#deleting-the-data-ebs) to destroy it. |
| `region` | no | `us-east-1` | AWS region. |
| `domain` | no | `localhost` | Primary domain for app and certbot. When `domains` is empty, also used for Cloudflare DNS. |
| `domains` | no | `[]` | List of domains for Cloudflare A records. Root domains get both @ and www. |
| `cloudflare_api_token` | no | `""` | When set with a zone (by id or name), creates/updates A records for `domains` pointing to instance IP. |
| `cloudflare_zone_id` | no | `""` | Cloudflare zone ID (optional). If unset, zone is looked up by `cloudflare_zone_name` or `domain`. |
| `cloudflare_zone_name` | no | `""` | Cloudflare zone name (e.g. `example.com`). Looked up via API when `cloudflare_zone_id` is unset; defaults to `domain`. |
| `certbot_email` | no | `""` | Email for Let's Encrypt (nginx only). Blank = HTTP or use `self_signed_cert` for HTTPS. |
| `self_signed_cert` | no | `"0"` | When `certbot_email` is blank: `"1"` = self-signed HTTPS, `"0"` = HTTP only. |
| `key_name` | no | - | EC2 key pair for SSH. |
| `ssh_public_key` | no | `""` | Raw SSH public key; added to root/harborfm `authorized_keys` on first boot. |
| `ssh_allowed_cidr` | no | `"192.168.1.1/32"` | CIDR allowed for SSH (port 22). Default effectively closes SSH; set `0.0.0.0/0` to allow all or `1.2.3.4/32` for your IP. |
| `vpc_id` | no | default VPC | VPC ID. |
| `subnet_id` | no | first subnet | Subnet ID. |
| `install_dir` | no | `""` | Install directory on the instance (passed to user-data). |
| `harborfm_repo` | no | `loganrickert/harborfm` | GitHub repo for Harbor FM. |
| `harborfm_branch` | no | `main` | Branch to use for clone. |
| `tags` | no | `{}` | Tags to apply to the instance and security group. |
| `environment` | no | `""` | Label (e.g. `dev`, `prod`) for the instance/sg Name tag when running multiple environments. |
| `webrtc_enabled` | no | `"0"` | WebRTC/group calls: `"1"` = enabled, `"0"` = disabled. |
| `reverse_proxy` | no | `"nginx"` | PM2 only: reverse proxy (`nginx` or `caddy`). |
| `setup_id` | no | `""` | Pre-set setup token for `/setup?id=...`. When set, the setup link is deterministic. |
| `cookie_secure` | no | `""` | Cookie Secure flag: `"false"` for HTTP (before TLS); empty = Secure cookies for HTTPS. |
| `admin_email` | no | `""` | Admin email for bootstrap. With `admin_password`, creates admin on first boot (hash sent, not plaintext). |
| `admin_password` | no | `""` | Admin password. Hashed with argon2 locally; only the hash is passed to the instance. Mark sensitive. |
| `admin_registration_enabled` | no | `"0"` | When bootstrapping: 1 = allow new account registration, 0 = disabled. |
| `admin_public_feeds_enabled` | no | `"1"` | When bootstrapping: 1 = public podcast feeds enabled, 0 = disabled. |
| `admin_hostname` | no | `""` | When bootstrapping: public base URL (e.g. `https://podcasts.example.com`). Empty = derive from `domain`. |
| `email_provider` | no | `"none"` | Email provider: `none` or `webhook`. When `webhook`, set `email_webhook_url`. |
| `email_webhook_url` | no | `""` | Webhook URL. Server POSTs `{ [email_webhook_field_key]: "Subject: …\n\nBody" }`. Use Discord webhook URL for Discord. |
| `email_webhook_field_key` | no | `"content"` | JSON key for the message body. Use `content` for Discord webhooks. |

### Example

```bash
cd terraform/terraform/aws
export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...

# Debian 12 + nginx (look up a Debian 12 AMI for your region: aws ec2 describe-images --owners 136693071363 --filters "Name=name,Values=debian-12-*" --query "Images[0].ImageId" --region us-east-1)
terraform init
terraform apply -var="deploy_type=nginx" \
  -var="ami_id=ami-XXXXXXXX" -var="domain=app.example.com" \
  -var="certbot_email=you@example.com" -var="key_name=my-key"
```

Outputs: `instance_id`, `public_ip`, `public_dns`, `url`.

### Deleting the data EBS

The persistent data volume (`data_volume_size` > 0) has `lifecycle { prevent_destroy = true }` so it is not deleted by `terraform destroy` (the instance and attachment are removed; the volume remains for a future apply). To **delete the data EBS volume** (and all data on it):

1. Remove the `lifecycle { prevent_destroy = true }` block from the `aws_ebs_volume.data` resource in `aws/main.tf`.
2. Run `terraform destroy` again; Terraform will destroy the volume.

Alternatively, to remove the volume from Terraform without deleting it in AWS (e.g. to manage it manually): `terraform state rm 'aws_ebs_volume.data[0]'` and, if used, `terraform state rm 'aws_volume_attachment.data[0]'`. Then run `terraform destroy` to clean up the rest. The volume will remain in your AWS account until you delete it in the EC2 console or CLI.

### Multiple environments (dev / prod)

To run a **second instance** (e.g. dev and prod) with the same config, use **Terraform workspaces**. Each workspace has its own state, so you get one instance per workspace.

```bash
cd terraform/terraform/aws
terraform init

# Create and use a workspace per environment
terraform workspace new dev
terraform workspace select dev
# Use dev tfvars or -var (e.g. domain=dev.example.com, instance_type=t3.small)
terraform apply -var-file=terraform.tfvars   # or a dev-specific tfvars

terraform workspace new prod
terraform workspace select prod
# Use prod tfvars (e.g. domain=podcasts.example.com)
terraform apply -var-file=terraform.tfvars
```

Switch environments with `terraform workspace select dev` or `terraform workspace select prod`. List workspaces with `terraform workspace list`.

**Optional:** set `environment = "dev"` or `environment = "prod"` in your tfvars so the instance and security group Name tags include the label (e.g. `harborfm-dev-debian-12-pm2`) in the AWS console.

**Alternative:** use separate directories (e.g. copy `aws/` to `aws-dev/` and `aws-prod/`) each with its own `terraform.tfvars` and state. More isolation, more duplication.

---

## Vultr (`vultr/`)

Creates a Vultr instance with the chosen user-data script.

### Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `os` | yes | - | One of: `debian-11`, `debian-12`, `debian-13`, `ubuntu-22`, `ubuntu-24`, `ubuntu-25`, `centos-9`, `centos-10`. Must match `os_id`. |
| `deploy_type` | yes | - | One of: `nginx`, `caddy`, `pm2`. |
| `region` | yes | - | Vultr region ID (e.g. `ewr`, `lax`). |
| `os_id` | yes | - | Vultr OS image ID (see [Vultr API list-os](https://www.vultr.com/api/#operation/list-os)). |
| `plan` | no | `vc2-1c-1gb` | Vultr plan ID. |
| `domain` | no | `localhost` | Primary domain for app and certbot. |
| `domains` | no | `[domain]` | List of domains for Cloudflare A records. Root domains get both @ and www. |
| `certbot_email` | no | `""` | Email for Let's Encrypt. Blank = HTTP or use `self_signed_cert` for HTTPS. |
| `self_signed_cert` | no | `"0"` | When `certbot_email` is blank: `"1"` = self-signed HTTPS, `"0"` = HTTP only. |
| `cloudflare_api_token` | no | `""` | When set with a zone (by id or name), creates/updates A records for `domains` pointing to instance IP. |
| `cloudflare_zone_id` | no | `""` | Cloudflare zone ID (optional). If unset, zone is looked up by `cloudflare_zone_name` or `domain`. |
| `cloudflare_zone_name` | no | `""` | Cloudflare zone name (e.g. `example.com`). Looked up via API when `cloudflare_zone_id` is unset; defaults to `domain`. |
| `webrtc_enabled` | no | `"0"` | WebRTC/group calls: `"1"` = enabled, `"0"` = disabled. |
| `setup_id` | no | `""` | Pre-set setup token for `/setup?id=...`. When set, the setup link is deterministic. |
| `cookie_secure` | no | `""` | Cookie Secure flag: `"false"` for HTTP (before TLS); empty = Secure cookies for HTTPS. |
| `reverse_proxy` | no | `"nginx"` | PM2 only: reverse proxy (`nginx` or `caddy`). |
| `admin_email` | no | `""` | Admin email for bootstrap. With `admin_password`, creates admin on first boot (hash sent, not plaintext). |
| `admin_password` | no | `""` | Admin password. Hashed with argon2 locally; only the hash is passed to the instance. Mark sensitive. |
| `admin_registration_enabled` | no | `"0"` | When bootstrapping: 1 = allow new account registration, 0 = disabled. |
| `admin_public_feeds_enabled` | no | `"1"` | When bootstrapping: 1 = public podcast feeds enabled, 0 = disabled. |
| `admin_hostname` | no | `""` | When bootstrapping: public base URL (e.g. `https://podcasts.example.com`). Empty = derive from `domain`. |
| `backups` | no | `"enabled"` | Vultr automatic backups: `enabled`, `disabled`, or `schedule`. |
| `data_volume_size` | no | `0` | Persistent data block storage in GB (data, secrets, webrtc). When > 0, a block volume is attached and user-data mounts it at `/mnt/harborfm-data`; set to `0` to use root disk only. |
| `email_provider` | no | `"none"` | Email provider: `none` or `webhook`. When `webhook`, set `email_webhook_url`. |
| `email_webhook_url` | no | `""` | Webhook URL. Server POSTs `{ [email_webhook_field_key]: "Subject: …\n\nBody" }`. Often contains secrets; use -var or TF_VAR. |
| `email_webhook_field_key` | no | `"content"` | JSON key for the message body. Use `content` for Discord webhooks. |
| `ssh_public_key` | no | `""` | Raw SSH public key; added to root/harborfm `authorized_keys` on first boot. Use instead of `ssh_key_ids` to avoid pre-registering keys. |
| `ssh_allowed_cidr` | no | `"192.168.1.1/32"` | CIDR allowed for SSH (port 22). Default effectively closes SSH; set `0.0.0.0/0` to allow all or `1.2.3.4/32` for your IP. |
| `ssh_key_ids` | no | `[]` | Vultr SSH key IDs (UUIDs). Use `ssh_public_key` for raw key. |

### Example

```bash
cd terraform/terraform/vultr
export VULTR_API_KEY=...

terraform init
terraform apply -var="os=debian-12" -var="deploy_type=nginx" \
  -var="region=ewr" -var="os_id=XXXX" -var="domain=app.example.com"
```

Outputs: `instance_id`, `public_ip`, `url`.

### Deleting the data block storage (Vultr)

The persistent data volume (`data_volume_size` > 0) has `lifecycle { prevent_destroy = true }` so it is not deleted by `terraform destroy` (the instance is removed; the volume remains for a future apply). To **delete the block storage volume** (and all data on it):

1. Remove the `lifecycle { prevent_destroy = true }` block from the `vultr_block_storage.data` resource in `vultr/main.tf`.
2. Run `terraform destroy` again.
