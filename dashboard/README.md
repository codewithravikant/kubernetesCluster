# Dashboard (operator UI)

Control plane for Cluster Chronicles. Starts/stops Minikube, shows namespace readiness, Observe charts, and host vitals.

## Quick start

```bash
make dashboard          # http://127.10.10.10:3030  — admin / devops
make dashboard-dev      # same address; API on 127.10.10.10:3031
```

## Features

- **Start Cluster** → `make chronicles` with live progress
- **Stop** / **Destroy** → `minikube stop` / `minikube delete`
- Namespace cards: `app`, `monitoring`, `logging`, `cicd`
- CPU / RAM edits → [`config/cluster.yml`](../config/cluster.yml) (cap 8 vCPU / 18 GB)
- Observe → Prometheus, Elasticsearch, and Grafana through their ClusterIP Services. The UI itself is http://127.10.10.10:3030
- Host tab → free RAM, disk, load on the machine running the dashboard

Stretch (Netdata / WireGuard) is removed in this project.
