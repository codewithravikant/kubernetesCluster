# Networking

## Pod model

Every pod gets its own IP. Pods on the same cluster can talk without NAT. Cross-node traffic uses the CNI (Minikube’s bridge).

## kube-proxy

Implements Services by programming iptables/IPVS so a ClusterIP load-balances across ready endpoints. Frontend with 2 replicas gets round-robin style distribution through the Service.

## Service types (why we chose these)

| Type | Use here |
|------|----------|
| **ClusterIP** | backend `:3000` (1 pod) and frontend `:80` (2 pods) — internal only |
| **Ingress** | external HTTP to the frontend Service. Both rules use that Service |
| NodePort / LoadBalancer | oral comparison only; not used for the app |

## Ingress `chronicles`

Class `nginx`. Address is the Minikube IP (`kubectl get ingress -n app`).

| Rule | Path | Service |
|------|------|---------|
| Host `chronicles.local` | `/` | `frontend:80` |
| Catch-all (any other Host) | `/` | `frontend:80` |

These are two routes, not two replicas. The Service load-balances across the two ready frontend endpoints. The Ingress field **Backend** means that Service. The API Deployment stays on `backend.app.svc.cluster.local:3000`; the frontend proxies `/api/` to it.

CoreDNS rewrites `chronicles.local` to `ingress-nginx-controller.ingress-nginx.svc.cluster.local` so in-cluster clients resolve the assigned hostname. Prometheus scrapes the controller metrics Service on port 10254 and probes `http://chronicles.local/` and `http://chronicles.local/api/health`.

## NetworkPolicy

Default deny ingress in `app`, then allow:

- Ingress controller → frontend `:80`
- frontend → backend `:3000`
- monitoring namespace → backend scrapes
- DNS egress to kube-system

Files: [`manifests/security/network-policies.yaml`](../manifests/security/network-policies.yaml), [`manifests/app/ingress.yaml`](../manifests/app/ingress.yaml).
