# Security

## RBAC

Jenkins uses ServiceAccount `jenkins` in `cicd` with a **Role** in `app` limited to get/list/watch/patch Deployments (and read pods). It is not cluster-admin.

File: [`manifests/security/cicd-rbac.yaml`](../manifests/security/cicd-rbac.yaml).

## Secrets

- Secret `app-secrets` holds `API_TOKEN` and `DB_PASSWORD`
- Mounted as env and as a volume under `/var/run/secrets/app`
- `make chronicles` generates fresh random values at install time (nothing stored in the tree)
- Rotate: recreate the Secret, then `kubectl rollout restart deployment/backend -n app`

## Plaintext policy

No API keys, passwords, webhooks, or SSH private keys in the project tree. App credentials exist only as live cluster Secrets.

## Segmentation

Namespaces separate app, monitoring, logging, and cicd. NetworkPolicies restrict east-west traffic in `app`.
