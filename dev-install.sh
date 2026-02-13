#!/usr/bin/env bash
set -eux

sudo apt update
sudo apt install -y build-essential curl wget git ffmpeg tini python3 ca-certificates libmad0 \
    libid3tag0 libboost-program-options-dev geoipupdate smbclient

if [[ "$TARGETARCH" == "amd64" ]]; then
  DEB_ARCH="amd64"
elif [[ "$TARGETARCH" == "arm64" ]]; then
  DEB_ARCH="arm64"
else
  echo "Unsupported arch: $TARGETARCH"
  exit 1
fi

DEB_URL="https://github.com/bbc/audiowaveform/releases/download/1.10.2/audiowaveform_1.10.2-1-12_${DEB_ARCH}.deb"
DEB_FILE="/tmp/audiowaveform.deb"

wget -O "$DEB_FILE" "$DEB_URL"

if ! dpkg -i "$DEB_FILE"; then
  apt-get update
  apt-get -f install -y
fi

rm -f "$DEB_FILE"

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable
sudo corepack prepare pnpm@latest --activate

# Install Docker
sudo apt update
sudo apt install -y ca-certificates curl gnupg

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker $USER
newgrp docker

sudo apt update
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list

sudo apt update
sudo apt install caddy

pnpm install
