# BharatStudio Infrastructure

Infrastructure-only repository for Cloudflare/GCP environment configuration, Cloud Run/Tasks/Scheduler infrastructure, IAM, domains, secrets references, monitoring, policies, deployment controls, and runbooks.

It must not contain product business logic, database migrations, application secrets, or scheduler business logic.

## v1 deployment boundary

`deployment/v1/manifest.template.json` is the checked-in topology contract for
the first Alerts release. It deliberately remains `not-deployable`: unresolved
region, compute, Cloud Run sizing, service-account, secret-reference, retry and
staging values are represented as `REQUIRED_*` placeholders. The manifest is
evidence of the intended boundary, not proof that the cloud resources exist.

The contract establishes these non-negotiable boundaries:

- `alerts-api` owns public web/API surfaces and OIDC-protected internal routes.
- `payment-webhook` exposes only the Razorpay signature/event-ID webhook as a
  public provider ingress; its internal routes require OIDC.
- `alert-worker` has no public ingress and is reachable only through private
  authenticated task/pump paths.
- `DATABASE_URL_APP` is the pooled application connection; the overlay
  listener requires a separate `DATABASE_URL_DIRECT`. Pooled `LISTEN/NOTIFY`
  is never a correctness path.
- The Go payment service and Alert Worker use their own service-specific
  database secret references; the API direct-listener secret is never mounted
  into the worker.
- Each service lists the exact required runtime environment names from its
  bootstrap. The values are deployment inputs; this repository stores neither
  their secret contents nor provider credentials.
- The Alerts web build separately requires `API_ORIGIN`,
  `NEXT_PUBLIC_API_ORIGIN`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and the public
  `NEXT_PUBLIC_RAZORPAY_KEY_ID`. The web build must never receive the Razorpay
  secret; production browser code rejects missing, local or non-HTTPS API
  origins.
- The Alerts static build must publish `apps/web/public/_headers` with the
  checked-in CSP, framing, referrer, permissions and content-type protections.
  The provider allow-list is deliberately limited to Google sign-in,
  Razorpay Checkout and the BharatStudio API domain; changing it is a reviewed
  deployment-contract change.
- Scheduler definitions remain in `bharatstudio-crons` and never receive a
  database credential.
- Cloud Tasks and Cloud Scheduler remain disabled until the launch authority,
  IAM/OIDC, provider, staging recovery, capacity, observability and rollback
  gates are evidenced.

Run `npm test` in this repository to verify the contract. No test provisions
cloud resources or treats placeholders as deployable values.
