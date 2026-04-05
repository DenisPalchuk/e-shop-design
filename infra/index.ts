import * as aws from "@pulumi/aws";
import { createAtlasResources } from "./atlas";
import { getInfraConfig } from "./config";
import { lambdaDefinitions, queueDefinitions, routeDefinitions } from "./definitions";
import { HttpApi } from "./components/http-api";
import { LambdaService } from "./components/lambda-service";
import { QueueSubscription } from "./components/queue-subscription";

const config = getInfraConfig();
const atlas = createAtlasResources(config);

const eventBus = new aws.cloudwatch.EventBus("checkout-event-bus", {
  name: config.eventBusName,
  tags: config.tags,
});

const lambdaEnvironment = {
  EVENTBRIDGE_BUS_NAME: eventBus.name,
  MONGODB_URI: atlas.mongoUri,
  NODE_OPTIONS: "--enable-source-maps",
};

const lambdaServices = {
  ordersApi: new LambdaService("orders-api-service", {
    ...lambdaDefinitions.ordersApi,
    namePrefix: config.namePrefix,
    environment: lambdaEnvironment,
    tags: config.tags,
    eventBusArn: eventBus.arn,
  }),
  invoicesApi: new LambdaService("invoices-api-service", {
    ...lambdaDefinitions.invoicesApi,
    namePrefix: config.namePrefix,
    environment: lambdaEnvironment,
    tags: config.tags,
  }),
  invoicesSqs: new LambdaService("invoices-sqs-service", {
    ...lambdaDefinitions.invoicesSqs,
    namePrefix: config.namePrefix,
    environment: lambdaEnvironment,
    tags: config.tags,
    eventBusArn: eventBus.arn,
  }),
  paymentsSqs: new LambdaService("payments-sqs-service", {
    ...lambdaDefinitions.paymentsSqs,
    namePrefix: config.namePrefix,
    environment: lambdaEnvironment,
    tags: config.tags,
    eventBusArn: eventBus.arn,
  }),
  shipmentsApi: new LambdaService("shipments-api-service", {
    ...lambdaDefinitions.shipmentsApi,
    namePrefix: config.namePrefix,
    environment: lambdaEnvironment,
    tags: config.tags,
    eventBusArn: eventBus.arn,
  }),
  shipmentsSqs: new LambdaService("shipments-sqs-service", {
    ...lambdaDefinitions.shipmentsSqs,
    namePrefix: config.namePrefix,
    environment: lambdaEnvironment,
    tags: config.tags,
    eventBusArn: eventBus.arn,
  }),
  ordersSqs: new LambdaService("orders-sqs-service", {
    ...lambdaDefinitions.ordersSqs,
    namePrefix: config.namePrefix,
    environment: lambdaEnvironment,
    tags: config.tags,
  }),
  inventorySqs: new LambdaService("inventory-sqs-service", {
    ...lambdaDefinitions.inventorySqs,
    namePrefix: config.namePrefix,
    environment: lambdaEnvironment,
    tags: config.tags,
    eventBusArn: eventBus.arn,
  }),
  notificationsSqs: new LambdaService("notifications-sqs-service", {
    ...lambdaDefinitions.notificationsSqs,
    namePrefix: config.namePrefix,
    environment: lambdaEnvironment,
    tags: config.tags,
  }),
};

const queueSubscriptions = {
  invoicesEvents: new QueueSubscription(queueDefinitions[0].name, {
    queueName: queueDefinitions[0].queueName,
    detailTypes: [...queueDefinitions[0].detailTypes],
    targetLambda: lambdaServices[queueDefinitions[0].lambdaKey].lambda,
    eventBus,
    namePrefix: config.namePrefix,
    tags: config.tags,
  }),
  paymentsEvents: new QueueSubscription(queueDefinitions[1].name, {
    queueName: queueDefinitions[1].queueName,
    detailTypes: [...queueDefinitions[1].detailTypes],
    targetLambda: lambdaServices[queueDefinitions[1].lambdaKey].lambda,
    eventBus,
    namePrefix: config.namePrefix,
    tags: config.tags,
  }),
  shipmentsEvents: new QueueSubscription(queueDefinitions[2].name, {
    queueName: queueDefinitions[2].queueName,
    detailTypes: [...queueDefinitions[2].detailTypes],
    targetLambda: lambdaServices[queueDefinitions[2].lambdaKey].lambda,
    eventBus,
    namePrefix: config.namePrefix,
    tags: config.tags,
  }),
  ordersEvents: new QueueSubscription(queueDefinitions[3].name, {
    queueName: queueDefinitions[3].queueName,
    detailTypes: [...queueDefinitions[3].detailTypes],
    targetLambda: lambdaServices[queueDefinitions[3].lambdaKey].lambda,
    eventBus,
    namePrefix: config.namePrefix,
    tags: config.tags,
  }),
  inventoryEvents: new QueueSubscription(queueDefinitions[4].name, {
    queueName: queueDefinitions[4].queueName,
    detailTypes: [...queueDefinitions[4].detailTypes],
    targetLambda: lambdaServices[queueDefinitions[4].lambdaKey].lambda,
    eventBus,
    namePrefix: config.namePrefix,
    tags: config.tags,
  }),
  notificationsEvents: new QueueSubscription(queueDefinitions[5].name, {
    queueName: queueDefinitions[5].queueName,
    detailTypes: [...queueDefinitions[5].detailTypes],
    targetLambda: lambdaServices[queueDefinitions[5].lambdaKey].lambda,
    eventBus,
    namePrefix: config.namePrefix,
    tags: config.tags,
  }),
};

const httpApi = new HttpApi("checkout-http-api-component", {
  logicalName: "checkout-http-api",
  namePrefix: config.namePrefix,
  tags: config.tags,
  routes: routeDefinitions.map((route) => ({
    name: route.name,
    routeKey: route.routeKey,
    lambdaFunction: lambdaServices[route.lambdaKey].lambda,
  })),
});

export const apiUrl = httpApi.invokeUrl;
export const eventBusArn = eventBus.arn;
export const atlasProjectId = atlas.projectId;
export const atlasClusterName = atlas.clusterName;
export const atlasDatabaseUser = atlas.dbUsername;
export const atlasSrvConnectionString = atlas.mongoSrv;
export const invoicesQueueName = queueSubscriptions.invoicesEvents.queue.name;
export const paymentsQueueName = queueSubscriptions.paymentsEvents.queue.name;
export const shipmentsQueueName = queueSubscriptions.shipmentsEvents.queue.name;
export const ordersQueueName = queueSubscriptions.ordersEvents.queue.name;
export const inventoryQueueName = queueSubscriptions.inventoryEvents.queue.name;
export const notificationsQueueName = queueSubscriptions.notificationsEvents.queue.name;
export const lambdaNames = {
  ordersApi: lambdaServices.ordersApi.lambda.name,
  invoicesApi: lambdaServices.invoicesApi.lambda.name,
  invoicesSqs: lambdaServices.invoicesSqs.lambda.name,
  paymentsSqs: lambdaServices.paymentsSqs.lambda.name,
  shipmentsApi: lambdaServices.shipmentsApi.lambda.name,
  shipmentsSqs: lambdaServices.shipmentsSqs.lambda.name,
  ordersSqs: lambdaServices.ordersSqs.lambda.name,
  inventorySqs: lambdaServices.inventorySqs.lambda.name,
  notificationsSqs: lambdaServices.notificationsSqs.lambda.name,
};
