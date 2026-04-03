# Infrastructure Deployment

This repository now includes a Pulumi-based deployment in `infra/` for:

- AWS Lambda functions for the existing handlers in `src/services/orders/handler.ts`, `src/services/invoices/handler.ts`, `src/services/payments/handler.ts`, and `src/services/shipments/handler.ts`
- One HTTP API Gateway with the current public routes
- A custom EventBridge bus
- SQS queues between EventBridge and the async Lambda consumers
- A MongoDB Atlas project, M0 free-tier cluster, IP access list entry, and app database user

## What Gets Deployed

### API Gateway routes

- `POST /v1/orders` → orders Lambda
- `GET /v1/orders/{orderId}` → orders Lambda
- `GET /v1/orders/{orderId}/invoice` → invoices Lambda
- `POST /v1/webhooks/shipment-status` → shipments Lambda

### EventBridge to SQS subscriptions

- `order.priced` → invoices SQS Lambda
- `order.created` + `invoice.generated` → payments SQS Lambda
- `order.created` + `payment.succeeded` → shipments SQS Lambda

## Free-Tier Notes

- AWS resources stay within a low-cost dev footprint: HTTP API Gateway, Lambda, EventBridge, and SQS only.
- MongoDB Atlas uses an `M0` cluster on AWS-backed shared tenancy.
- The Atlas access list defaults to `0.0.0.0/0` because Lambda egress IPs are not fixed without adding paid networking. Treat this as a dev-only baseline.

## Pulumi State in S3

Create an S3 bucket first and use it as the Pulumi backend. Example backend URL:

```text
s3://my-pulumi-state-bucket/checkout?region=eu-central-1
```

Set that URL in the GitHub secret `PULUMI_BACKEND_URL`.
s3://e-shop-pulumi-839701728923-eu-central-1-an/pulumi/
## Required GitHub Secrets

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `PULUMI_BACKEND_URL`: S3 backend URL
- `PULUMI_CONFIG_PASSPHRASE`: passphrase for encrypting stack secrets in the self-managed backend
- `MONGODB_ATLAS_PUBLIC_KEY`
- `MONGODB_ATLAS_PRIVATE_KEY`

## Recommended GitHub Variables

- `AWS_REGION`
- `PULUMI_STACK`
- `ATLAS_ORG_ID`
- `ATLAS_PROJECT_NAME`
- `ATLAS_CLUSTER_NAME`
- `ATLAS_DATABASE_NAME`
- `ATLAS_DB_USERNAME`
- `ATLAS_REGION`
- `ATLAS_ACCESS_LIST_CIDR`
- `RESOURCE_NAME_PREFIX`
- `EVENTBRIDGE_BUS_NAME`

## Local Usage

Install dependencies and build the Lambda bundles:

```bash
cd /Users/denispalcuk/Documents/projects/e-shop-design/src && npm ci
cd /Users/denispalcuk/Documents/projects/e-shop-design/infra && npm ci
cd /Users/denispalcuk/Documents/projects/e-shop-design/infra && npm run build:lambdas
```

Select your S3 backend and stack, then deploy:

```bash
cd /Users/denispalcuk/Documents/projects/e-shop-design/infra
pulumi login "$PULUMI_BACKEND_URL"
pulumi stack select dev --create
pulumi up
```

The Pulumi program accepts either stack config or environment variables. The GitHub Actions workflow uses environment variables so the same stack can be driven cleanly from CI.

## Current Scope

The deployment matches the handlers that already exist in the codebase. The broader architecture docs mention inventory and pricing services, but those producers are not implemented in the repository yet, so this stack does not create Lambdas for them.
