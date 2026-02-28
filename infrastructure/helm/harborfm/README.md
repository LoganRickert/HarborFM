# HarborFM Helm Chart

Deploy HarborFM (podcast hosting and recording) to Kubernetes. Uses standard resources only; works on **local** (minikube, kind, k3d), **AWS EKS**, and **Vultr Kubernetes Engine (VKE)**. Set `persistence.storageClass` and `ingress.className` per cluster.

## Requirements

- Kubernetes >= 1.21
- An Ingress controller (nginx, traefik, AWS ALB, etc.) if `ingress.enabled` is true
- Optional: cert-manager for TLS, or provide an existing TLS secret

## Firewall (ports to open)

Open these on the firewall or security group for the load balancer / nodes that receive traffic:

| Port(s)        | Protocol | Purpose |
|----------------|----------|---------|
| **80**         | TCP      | HTTP (Ingress); redirect or serve app. |
| **443**        | TCP      | HTTPS (Ingress); serve app. |
| **41000–41100**| UDP      | Only if WebRTC is enabled and you expose mediasoup RTP (e.g. via a LoadBalancer or hostNetwork). The chart does not expose these by default; the WebSocket path `/webrtc-ws/` uses TCP over 80/443. |

Ensure **TCP 80** and **TCP 443** are open to the Ingress controller (or its LoadBalancer) so the app is reachable.

## Connect to your cluster first

Install **kubectl** and **Helm** if you don’t have them, then configure access to your cluster so `helm` and `kubectl` talk to the right API.

- **Vultr Kubernetes Engine (VKE):** In the Vultr dashboard, open your cluster and download the kubeconfig file (or copy its contents). Save it (e.g. `~/.kube/config-vultr`) and point kubectl at it:
  ```bash
  export KUBECONFIG=~/.kube/config-vultr
  # Or merge into default: cat config-vultr >> ~/.kube/config
  ```
- **AWS EKS:** `aws eks update-kubeconfig --region <region> --name <cluster-name>`
- **Local (minikube, kind, k3d):** Start the cluster (e.g. `minikube start`); it usually updates the default kubeconfig automatically.

Check that you’re connected:

```bash
kubectl cluster-info
kubectl get nodes
```

If these work, proceed to Install below.

## Install

```bash
# From repo root
helm upgrade --install harborfm ./infrastructure/helm/harborfm -f infrastructure/helm/harborfm/values.yaml

# With overrides (Terraform-style: image tag, admin, domain, webrtc)
helm upgrade --install harborfm ./infrastructure/helm/harborfm -f infrastructure/helm/harborfm/values.yaml -f myvalues.yaml
```

Or use the wrapper script (loads `.env` if present):

```bash
cd infrastructure/helm && ./run.sh upgrade
# Or: ./run.sh install -f myvalues.yaml
```

## Verify the install

After a successful Helm install, confirm the release and pods:

```bash
helm list
kubectl get pods -l app.kubernetes.io/name=harborfm
```

If the main app pod is in `CrashLoopBackOff`, inspect why:

```bash
# Pod events and exit reason
kubectl describe pod -l app.kubernetes.io/component=app

# Last logs from the harborfm container
kubectl logs -l app.kubernetes.io/component=app --tail=100

# Logs from the previous run (after a crash)
kubectl logs -l app.kubernetes.io/component=app --previous --tail=100
```

Common causes: bad or missing env/secret (e.g. `ADMIN_PASSWORD_HASH`, paths), unwritable `DATA_DIR`, or wrong image.

**Nothing loads when I open the cluster IP** – The chart creates an **Ingress resource** (rules for routing), but something must **implement** it: an **Ingress controller** (e.g. nginx-ingress, traefik) that listens on 80/443 and forwards to your Ingress. Many clusters (including Vultr VKE) do **not** ship with one. Install an Ingress controller and expose it so traffic reaches the cluster:

```bash
# Example: install NGINX Ingress Controller (creates a LoadBalancer service)
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx --set controller.service.type=LoadBalancer
```

Then wait for the controller’s LoadBalancer to get an external IP (`kubectl get svc -n default ingress-nginx-controller` or the namespace you used). Open **TCP 80** and **TCP 443** to that IP in your cloud firewall, and use that IP (or a DNS name pointing to it) to reach the app. Ensure `ingress.className` in values matches the controller (e.g. `nginx` for the chart above). If you use a different controller (traefik, etc.), install it and set `ingress.className` accordingly.

### Get the public IP for DNS

Point your domain's **A record** to the Ingress controller's LoadBalancer **EXTERNAL-IP** (not the cluster API IP). To get it with kubectl:

```bash
# List LoadBalancer services and their EXTERNAL-IP (use the one for your Ingress controller)
kubectl get svc -A | grep LoadBalancer
```

For the default NGINX Ingress install (e.g. in `ingress-nginx` or `default` namespace):

```bash
kubectl get svc -A -o wide | grep ingress-nginx
```

Set your DNS A record for the host (e.g. `app.harborfm.com`) to the **EXTERNAL-IP** shown there.

## Customization (Terraform-aligned)

- **Images**: `image.repository`, `image.tag` (e.g. `main` or `v1.0`). Same for `webrtc.image` when WebRTC is enabled.
- **Admin**: Set `admin.email` and `admin.existingPasswordSecret` (name/key of a Secret containing the bcrypt hash). Create the hash with the server script: `node server/scripts/hash-admin-password.mjs`. Or create a Secret manually and reference it.
- **Setup token**: `setupId` for `/setup?id=...`, or use an existing Secret.
- **Domain / Ingress**: `ingress.host`, `ingress.className`, `ingress.tls.enabled`, `ingress.tls.existingSecret` or cert-manager annotations. Set `ingress.host` to what you type in the browser: use the LoadBalancer IP (e.g. `"149.28.44.122"`) for IP access, or your domain (e.g. `"harborfm.example.com"`) if DNS points to the cluster. `localhost` only matches when the request’s Host header is literally `localhost`, so it won’t work when visiting `http://<external-ip>`.
- **WebRTC**: `webrtc.enabled`, `webrtc.publicWsUrl` (e.g. `wss://example.com/webrtc-ws`), `webrtc.mediasoupAnnouncedIp`, `webrtc.serviceSecret`, `webrtc.recordingCallbackSecret`.
- **Persistence**: `persistence.storageClass` (empty = cluster default), `persistence.data.size`, etc.

See `values.example.yaml` for commented examples.

## TLS

- Set `ingress.tls.enabled: true` and either:
  - `ingress.tls.existingSecret: "my-tls-secret"` (existing TLS secret in the namespace), or
  - Use cert-manager: set `ingress.annotations` with e.g. `cert-manager.io/cluster-issuer: letsencrypt-prod` and the same `ingress.tls.existingSecret` (or leave default); cert-manager will create the secret.

## Persistence

PVCs are created for app data, secrets, webrtc recordings, and whisper cache. Use `persistence.storageClass` to match your cluster (e.g. Vultr VKE: install vultr-csi and set the StorageClass name; EKS: default or EBS/EFS).

## WebRTC

When `webrtc.enabled` is true, the chart deploys the webrtc service and wires the Ingress path `/webrtc-ws/` to it. The app’s WebRTC service URL is set to the internal Service. Set `webrtc.publicWsUrl` to the public WebSocket URL (e.g. `wss://yourdomain.com/webrtc-ws`). For production, mediasoup RTP (UDP 41000–41100) may require hostNetwork or a LoadBalancer that preserves UDP; see your Ingress/LB docs.

## Uninstall

```bash
helm uninstall harborfm
# PVCs are retained by default; delete them if you want to remove data.
```
