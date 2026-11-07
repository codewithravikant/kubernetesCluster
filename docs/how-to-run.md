# How to run

Operator guide for Cluster Chronicles on Minikube.

## First bring-up

```bash
# From the repo root on the machine that runs Docker
make chronicles
make status
make app-verify
```

Optional UI:

```bash
make dashboard
# open http://127.10.10.10:3030  — admin / devops
```

## Useful kubectl

```bash
kubectl get pods -A
kubectl get svc,ingress -n app
kubectl get pvc -A
kubectl logs -n app deploy/backend
kubectl describe pod -n app -l app=backend
kubectl rollout undo deployment/backend -n app
```

## Access

Assigned addresses only.

| Surface | Address |
|---------|---------|
| Dashboard | http://127.10.10.10:3030 — `admin` / `devops` |
| App through Ingress | http://chronicles.local/ — `kubectl get ingress -n app` shows the Minikube IP as ADDRESS |
| Frontend | `frontend.app.svc.cluster.local:80` |
| Backend | `backend.app.svc.cluster.local:3000` |
| Grafana | `kube-prometheus-stack-grafana.monitoring.svc.cluster.local` — `admin` / `devops` |
| Prometheus | `kps-prometheus.monitoring.svc.cluster.local:9090` |
| Kibana | `kibana.logging.svc.cluster.local:5601` |
| Jenkins | `jenkins.cicd.svc.cluster.local:8080` — `admin` / `devops` |

```bash
ip="$(minikube ip -p chronicles)"
curl -fsS -H "Host: chronicles.local" "http://${ip}/"
curl -fsS -H "Host: chronicles.local" "http://${ip}/api/health"
```

The named rule `chronicles.local /` and the catch-all `* /` both target Service `frontend:80`. Endpoints `2/2` are the two frontend pods. The API Deployment is reached only from the frontend at `/api/`.

## Cluster size

Edit [`config/cluster.yml`](../config/cluster.yml) or use the dashboard. Caps: **8 vCPU**, **18432 MB**. Apply restarts Minikube.

## Tear down

```bash
make stop       # keep disk
make destroy    # delete profile
```

## Related

- [cicd.md](cicd.md) — Jenkins jobs `chronicles-app` / `chronicles-rollback`
- [monitoring.md](monitoring.md) — alerts and demos
