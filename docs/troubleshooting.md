# Troubleshooting

## CrashLoopBackOff

```bash
kubectl get pods -n app
kubectl describe pod -n app <pod>
kubectl logs -n app <pod> --previous
kubectl logs -n app <pod> -c prepare-data   # init container
```

Look for: bad image, failing probe, missing Secret, init container error, OOMKilled.

## Pending (insufficient resources)

```bash
kubectl describe pod -n app <pod>
# Events: FailedScheduling — Insufficient cpu/memory
kubectl describe nodes
kubectl top nodes
```

Fix: lower requests, free the node, or raise Minikube memory in `config/cluster.yml` and restart.

## PVC not Bound

```bash
kubectl get pv,pvc -A
kubectl describe pvc -n app backend-data
```

Minikube usually auto-provisions `standard`. Explicit Retain PVs are under `manifests/storage/`.
