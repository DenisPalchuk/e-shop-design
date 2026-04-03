import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export interface InfraConfig {
  stack: string;
  atlasOrgId: string;
  atlasProjectName: string;
  atlasClusterName: string;
  atlasDatabaseName: string;
  atlasDbUsername: string;
  atlasRegion: string;
  atlasAccessListCidr: string;
  eventBusName: string;
  namePrefix: string;
  atlasPublicKey: pulumi.Input<string>;
  atlasPrivateKey: pulumi.Input<string>;
  tags: Record<string, string>;
}

export interface AtlasResources {
  projectId: pulumi.Output<string>;
  clusterName: pulumi.Output<string>;
  dbUsername: pulumi.Output<string>;
  mongoSrv: pulumi.Output<string>;
  mongoUri: pulumi.Output<string>;
}

export interface LambdaServiceArgs {
  logicalName: string;
  namePrefix: string;
  bundleName: string;
  handler: string;
  timeout: number;
  memorySize: number;
  environment: Record<string, pulumi.Input<string>>;
  tags: Record<string, string>;
  allowEventBridgePublish?: boolean;
  eventBusArn?: pulumi.Input<string>;
  sqsConsumer?: boolean;
}

export interface LambdaServiceOutputs {
  lambda: aws.lambda.Function;
  role: aws.iam.Role;
}

export interface QueueSubscriptionArgs {
  queueName: string;
  detailTypes: string[];
  targetLambda: aws.lambda.Function;
  eventBus: aws.cloudwatch.EventBus;
  namePrefix: string;
  tags: Record<string, string>;
  batchSize?: number;
}

export interface QueueSubscriptionOutputs {
  queue: aws.sqs.Queue;
  dlq: aws.sqs.Queue;
  rule: aws.cloudwatch.EventRule;
}

export interface HttpRouteDefinition {
  name: string;
  routeKey: string;
  lambdaFunction: aws.lambda.Function;
}

export interface HttpApiArgs {
  logicalName: string;
  namePrefix: string;
  tags: Record<string, string>;
  routes: HttpRouteDefinition[];
}

export interface HttpApiOutputs {
  api: aws.apigatewayv2.Api;
  stage: aws.apigatewayv2.Stage;
  invokeUrl: pulumi.Output<string>;
}
