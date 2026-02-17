# Terraform Quick Start

Get Harbor FM running on a VM (Vultr or AWS) in a few steps.

## 1. Install Terraform

```bash
# Debian (HashiCorp apt repo; same repo works on Ubuntu)
sudo apt-get update && sudo apt-get install -y gnupg software-properties-common
wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt-get update && sudo apt-get install -y terraform

==========
# CentOS / RHEL (HashiCorp repo)
sudo yum install -y yum-utils
sudo yum-config-manager --add-repo https://rpm.releases.hashicorp.com/RHEL/hashicorp.repo
sudo yum install -y terraform

# macOS (Homebrew)
brew install terraform

==========
# Or download from https://www.terraform.io/downloads
```

## 2. Choose Your Provider

| Provider | Use when |
|----------|----------|
| **Vultr** | Simple cloud VPS; good for personal/small deployments |
| **AWS** | You have an AWS account; need EC2 |

## 3. Set Up API Keys

Copy the env template and fill in your provider's credentials:

```bash
cd terraform/terraform/vultr   # or aws/

cp ../.env.example .env
# Edit .env and uncomment + fill:
#   Vultr: VULTR_API_KEY=...
#   AWS:   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
```

## 4. Configure Variables

```bash
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values (see comments for required vs optional)
```

**Required for Vultr:** `os`, `deploy_type`, `region`, `plan`, `os_id`  
**Required for AWS:** `os`, `deploy_type`, `ami_id`

For `admin_password`, prefer passing via CLI to avoid committing secrets:
```bash
export TF_VAR_admin_password="your-password"
```

## 5. Deploy

```bash
./run.sh init
./run.sh plan    # review changes
./run.sh apply   # confirm with 'yes'
```

## 6. Get Your URL

After apply completes:

```bash
# App URL
terraform output url

# If you didn't set admin_email, use the setup URL to complete initial setup:
terraform output -raw setup_url
```

Open the URL in your browser. First boot may take a few minutes while the instance installs Harbor FM.
