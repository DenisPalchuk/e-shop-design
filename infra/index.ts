import * as aws from "@pulumi/aws";
import * as mongodbatlas from "@pulumi/mongodbatlas";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import fs from "node:fs";
import path from "node:path";

const config = new pulumi.Config();
const stack = pulumi.getStack();

function getConfigOrEnv(name: string, envName: string, fallback?: string): string {
  const value = config.get(name) ?? process.env[envName] ?? fallback;
  if (!value) {
    throw new Error(`Missing required configuration "${name}" or environment variable "${envName}"`);
  }
  return value;
}

function getSecretConfigOrEnv(name: string, envName: string): pulumi.Input<string> {
  const secretValue = config.getSecret(name);
  if (secretValue) {
    return secretValue;
  }

  const envValue = process.env[envName];
  if (!envValue) {
    throw new Error(`Missing required secret "${name}" or environment variable "${envName}"`);
  }

  return pulumi.secret(envValue);
}

const atlasOrgId = getConfigOrEnv("atlasOrgId", "ATLAS_ORG_ID");
const atlasProjectName = getConfigOrEnv("atlasProjectName", "ATLAS_PROJECT_NAME", `e-shop-checkout-${stack}`);
const atlasClusterName = getConfigOrEnv("atlasClusterName", "ATLAS_CLUSTER_NAME", "checkout-free");
const atlasDbName = getConfigOrEnv("atlasDatabaseName", "ATLAS_DATABASE_NAME", "ecommerce");
const atlasDbUsername = getConfigOrEnv("atlasDbUsername", "ATLAS_DB_USERNAME", "checkoutapp");
const atlasRegion = getConfigOrEnv("atlasRegion", "ATLAS_REGION", "US_EAST_1");
const atlasAccessListCidr = getConfigOrEnv("atlasAccessListCidr", "ATLAS_ACCESS_LIST_CIDR", "0.0.0.0/0");
const eventBusName = getConfigOrEnv("eventBusName", "EVENTBRIDGE_BUS_NAME", "checkout-events");
const namePrefix = getConfigOrEnv("namePrefix", "RESOURCE_NAME_PREFIX", `checkout-${stack}`);

const atlasProvider = new mongodbatlas.Provider("atlas", {
  publicKey: getSecretConfigOrEnv("atlasPublicKey", "MONGODB_ATLAS_PUBLIC_KEY"),
  privateKey: getSecretConfigOrEnv("atlasPrivateKey", "MONGODB_ATLAS_PRIVATE_KEY"),
});

const repoRoot = path.resolve(__dirname, "..");
const artifactRoot = path.join(repoRoot, "src", ".artifacts");

function getArtifactPath(bundleName: string): string {
  const artifactPath = path.join(artifactRoot, bundleName);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `Lambda bundle "${bundleName}" was not found at ${artifactPath}. Run "npm run build:lambdas" from infra/ before deploying.`,
    );
  }
  return artifactPath;
}

const tags = {
  Project: "e-shop-design",
  Stack: stack,
  ManagedBy: "Pulumi",
};

const atlasProject = new mongodbatlas.Project(
  "atlas-project",
  {
    orgId: atlasOrgId,
    name: atlasProjectName,
  },
  { provider: atlasProvider },
);

const atlasAccessList = new mongodbatlas.ProjectIpAccessList(
  "atlas-access-list",
  {
    projectId: atlasProject.id,
    cidrBlock: atlasAccessListCidr,
    comment: "Public Lambda egress for the checkout dev stack",
  },
  { provider: atlasProvider },
);

const atlasClusterResource = new mongodbatlas.AdvancedCluster(
  "atlas-cluster",
  {
    projectId: atlasProject.id,
    name: atlasClusterName,
    clusterType: "REPLICASET",
    replicationSpecs: [
      {
        regionConfigs: [
          {
            providerName: "TENANT",
            backingProviderName: "AWS",
            regionName: atlasRegion,
            priority: 7,
            electableSpecs: {
              instanceSize: "M0",
            },
          },
        ],
      },
    ],
  },
  {
    provider: atlasProvider,
    dependsOn: [atlasAccessList],
  },
);

const dbPassword = new random.RandomPassword("atlas-db-password", {
  length: 24,
  special: false,
});

const atlasDbUser = new mongodbatlas.DatabaseUser(
  "atlas-db-user",
  {
    projectId: atlasProject.id,
    username: atlasDbUsername,
    password: dbPassword.result,
    authDatabaseName: "admin",
    roles: [
      {
        roleName: "readWrite",
        databaseName: atlasDbName,
      },
    ],
  },
  { provider: atlasProvider },
);

const mongoSrv = atlasClusterResource.connectionStrings.apply((connectionStrings: any) => {
  const srv = connectionStrings?.standardSrv ?? connectionStrings?.standard_srv;
  if (!srv) {
    throw new Error("MongoDB Atlas did not return a standard SRV connection string.");
  }
  return srv as string;
});

const mongoUri = pulumi
  .all([mongoSrv, dbPassword.result])
  .apply(([srv, password]) => {
    const url = new URL(srv);
    url.username = atlasDbUsername;
    url.password = password;
    url.pathname = `/${atlasDbName}`;
    url.searchParams.set("retryWrites", "true");
    url.searchParams.set("w", "majority");
    url.searchParams.set("appName", `${namePrefix}-lambda`);
    return url.toString();
  });

const eventBus = new aws.cloudwatch.EventBus("checkout-event-bus", {
  name: eventBusName,
  tags,
});

const lambdaEnvironment = {
  EVENTBRIDGE_BUS_NAME: eventBus.name,
  MONGODB_URI: mongoUri,
  NODE_OPTIONS: "--enable-source-maps",
};

const lambdaBasicExecutionPolicyArn =
  "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole";
const lambdaSqsExecutionPolicyArn =
  "arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole";

type LambdaArgs = {
  bundleName: string;
  handler: string;
  timeout: number;
  memorySize: number;
  allowEventBridgePublish?: boolean;
  sqsConsumer?: boolean;
};

function createLambdaRole(name: string, allowEventBridgePublish = false, sqsConsumer = false) {
  const role = new aws.iam.Role(`${name}-role`, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "lambda.amazonaws.com",
    }),
    tags,
  });

  new aws.iam.RolePolicyAttachment(`${name}-logs`, {
    role: role.name,
    policyArn: lambdaBasicExecutionPolicyArn,
  });

  if (sqsConsumer) {
    new aws.iam.RolePolicyAttachment(`${name}-sqs`, {
      role: role.name,
      policyArn: lambdaSqsExecutionPolicyArn,
    });
  }

  if (allowEventBridgePublish) {
    new aws.iam.RolePolicy(`${name}-put-events`, {
      role: role.id,
      policy: pulumi
        .all([eventBus.arn])
        .apply(([busArn]) =>
          JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: ["events:PutEvents"],
                Resource: [busArn],
              },
            ],
          }),
        ),
    });
  }

  return role;
}

function createLambdaFunction(name: string, args: LambdaArgs) {
  const role = createLambdaRole(name, args.allowEventBridgePublish, args.sqsConsumer);

  return new aws.lambda.Function(name, {
    name: `${namePrefix}-${name}`,
    role: role.arn,
    runtime: "nodejs20.x",
    architectures: ["arm64"],
    handler: args.handler,
    timeout: args.timeout,
    memorySize: args.memorySize,
    code: new pulumi.asset.FileArchive(getArtifactPath(args.bundleName)),
    environment: {
      variables: lambdaEnvironment,
    },
    tags,
  });
}

const ordersApi = createLambdaFunction("orders-api", {
  bundleName: "orders-api",
  handler: "index.handler",
  timeout: 15,
  memorySize: 256,
  allowEventBridgePublish: true,
});

const invoicesApi = createLambdaFunction("invoices-api", {
  bundleName: "invoices-api",
  handler: "index.apiHandler",
  timeout: 15,
  memorySize: 256,
});

const invoicesSqs = createLambdaFunction("invoices-sqs", {
  bundleName: "invoices-sqs",
  handler: "index.sqsHandler",
  timeout: 30,
  memorySize: 256,
  allowEventBridgePublish: true,
  sqsConsumer: true,
});

const paymentsSqs = createLambdaFunction("payments-sqs", {
  bundleName: "payments-sqs",
  handler: "index.sqsHandler",
  timeout: 30,
  memorySize: 256,
  allowEventBridgePublish: true,
  sqsConsumer: true,
});

const shipmentsApi = createLambdaFunction("shipments-api", {
  bundleName: "shipments-api",
  handler: "index.apiHandler",
  timeout: 15,
  memorySize: 256,
  allowEventBridgePublish: true,
});

const shipmentsSqs = createLambdaFunction("shipments-sqs", {
  bundleName: "shipments-sqs",
  handler: "index.sqsHandler",
  timeout: 30,
  memorySize: 256,
  allowEventBridgePublish: true,
  sqsConsumer: true,
});

type QueueSubscriptionArgs = {
  queueName: string;
  lambdaFunction: aws.lambda.Function;
  detailTypes: string[];
  batchSize?: number;
};

function createQueueSubscription(args: QueueSubscriptionArgs) {
  const dlq = new aws.sqs.Queue(`${args.queueName}-dlq`, {
    name: `${namePrefix}-${args.queueName}-dlq`,
    messageRetentionSeconds: 1_209_600,
    tags,
  });

  const queue = new aws.sqs.Queue(args.queueName, {
    name: `${namePrefix}-${args.queueName}`,
    visibilityTimeoutSeconds: 180,
    redrivePolicy: pulumi.interpolate`{"deadLetterTargetArn":"${dlq.arn}","maxReceiveCount":3}`,
    tags,
  });

  const rule = new aws.cloudwatch.EventRule(`${args.queueName}-rule`, {
    name: `${namePrefix}-${args.queueName}-rule`,
    eventBusName: eventBus.name,
    eventPattern: JSON.stringify({
      "detail-type": args.detailTypes,
    }),
    tags,
  });

  new aws.sqs.QueuePolicy(`${args.queueName}-policy`, {
    queueUrl: queue.id,
    policy: aws.iam
      .getPolicyDocumentOutput({
        statements: [
          {
            sid: "AllowEventBridge",
            effect: "Allow",
            principals: [
              {
                type: "Service",
                identifiers: ["events.amazonaws.com"],
              },
            ],
            actions: ["sqs:SendMessage"],
            resources: [queue.arn],
            conditions: [
              {
                test: "ArnEquals",
                variable: "aws:SourceArn",
                values: [rule.arn],
              },
            ],
          },
        ],
      })
      .json,
  });

  new aws.cloudwatch.EventTarget(`${args.queueName}-target`, {
    eventBusName: eventBus.name,
    rule: rule.name,
    arn: queue.arn,
  });

  new aws.lambda.EventSourceMapping(`${args.queueName}-mapping`, {
    eventSourceArn: queue.arn,
    functionName: args.lambdaFunction.arn,
    batchSize: args.batchSize ?? 5,
    maximumBatchingWindowInSeconds: 5,
  });

  return { queue, dlq, rule };
}

const invoicesQueue = createQueueSubscription({
  queueName: "invoices-events",
  lambdaFunction: invoicesSqs,
  detailTypes: ["order.priced"],
});

const paymentsQueue = createQueueSubscription({
  queueName: "payments-events",
  lambdaFunction: paymentsSqs,
  detailTypes: ["order.created", "invoice.generated"],
});

const shipmentsQueue = createQueueSubscription({
  queueName: "shipments-events",
  lambdaFunction: shipmentsSqs,
  detailTypes: ["order.created", "payment.succeeded"],
});

const httpApi = new aws.apigatewayv2.Api("checkout-http-api", {
  name: `${namePrefix}-http-api`,
  protocolType: "HTTP",
  tags,
});

const apiStage = new aws.apigatewayv2.Stage("checkout-http-api-stage", {
  apiId: httpApi.id,
  name: "$default",
  autoDeploy: true,
  tags,
});

function attachHttpRoute(name: string, routeKey: string, lambdaFunction: aws.lambda.Function) {
  const integration = new aws.apigatewayv2.Integration(`${name}-integration`, {
    apiId: httpApi.id,
    integrationType: "AWS_PROXY",
    integrationMethod: "POST",
    integrationUri: lambdaFunction.invokeArn,
    payloadFormatVersion: "2.0",
  });

  new aws.apigatewayv2.Route(`${name}-route`, {
    apiId: httpApi.id,
    routeKey,
    target: pulumi.interpolate`integrations/${integration.id}`,
  });

  new aws.lambda.Permission(`${name}-permission`, {
    action: "lambda:InvokeFunction",
    function: lambdaFunction.name,
    principal: "apigateway.amazonaws.com",
    sourceArn: pulumi.interpolate`${httpApi.executionArn}/*/*`,
  });
}

attachHttpRoute("orders-create", "POST /v1/orders", ordersApi);
attachHttpRoute("orders-get", "GET /v1/orders/{orderId}", ordersApi);
attachHttpRoute("invoice-get", "GET /v1/orders/{orderId}/invoice", invoicesApi);
attachHttpRoute("shipment-webhook", "POST /v1/webhooks/shipment-status", shipmentsApi);

export const apiUrl = apiStage.invokeUrl;
export const eventBusArn = eventBus.arn;
export const atlasProjectId = atlasProject.id;
export const atlasClusterNameOutput = atlasClusterResource.name;
export const atlasDatabaseUser = atlasDbUser.username;
export const atlasSrvConnectionString = mongoSrv;
export const invoicesQueueName = invoicesQueue.queue.name;
export const paymentsQueueName = paymentsQueue.queue.name;
export const shipmentsQueueName = shipmentsQueue.queue.name;
export const lambdaNames = {
  ordersApi: ordersApi.name,
  invoicesApi: invoicesApi.name,
  invoicesSqs: invoicesSqs.name,
  paymentsSqs: paymentsSqs.name,
  shipmentsApi: shipmentsApi.name,
  shipmentsSqs: shipmentsSqs.name,
};
