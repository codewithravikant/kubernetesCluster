# CI/CD (Jenkins)

## Why Jenkins

Local, offline-friendly pipeline on a dedicated namespace. No remote SCM — jobs and build context come from this machine.

## Install

`make chronicles` installs the Jenkins Helm chart into `cicd` and a local Docker registry (`registry:5000` in-cluster).

It also:

- Loads [`cicd/Jenkinsfile`](../cicd/Jenkinsfile) and [`cicd/Jenkinsfile.rollback`](../cicd/Jenkinsfile.rollback) into ConfigMap `jenkins-pipelines`
- Syncs `app/` and `scripts/` into Minikube hostPath `/mnt/data/chronicles-src` for agent builds

Re-run `make chronicles` (or the CI install path) after editing pipelines or app source so Jenkins sees the new files.

## Jobs

| Job | Pipeline |
|-----|----------|
| `chronicles-app` | Manual run. Loads local source from hostPath, then lint, test, Kaniko build/push, Trivy CRITICAL gate, kubectl deploy, smoke |
| `chronicles-rollback` | [`cicd/Jenkinsfile.rollback`](../cicd/Jenkinsfile.rollback) — `kubectl rollout undo` (manual) |

Agents are Kubernetes pods using ServiceAccount `jenkins`.

## Rolling updates and rollback

Deployments use `maxUnavailable: 0` / `maxSurge: 1`. Failed pipeline auto-undoes. Manual: `make rollback`.

## Image scanning

Trivy stage exits non-zero on CRITICAL findings so broken images never roll out.
