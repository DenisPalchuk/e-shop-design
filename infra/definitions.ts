export const lambdaDefinitions = {
  ordersApi: {
    logicalName: "orders-api",
    bundleName: "orders-api",
    handler: "index.handler",
    timeout: 15,
    memorySize: 256,
    allowEventBridgePublish: true,
  },
  invoicesApi: {
    logicalName: "invoices-api",
    bundleName: "invoices-api",
    handler: "index.apiHandler",
    timeout: 15,
    memorySize: 256,
  },
  invoicesSqs: {
    logicalName: "invoices-sqs",
    bundleName: "invoices-sqs",
    handler: "index.sqsHandler",
    timeout: 30,
    memorySize: 256,
    allowEventBridgePublish: true,
    sqsConsumer: true,
  },
  paymentsSqs: {
    logicalName: "payments-sqs",
    bundleName: "payments-sqs",
    handler: "index.sqsHandler",
    timeout: 30,
    memorySize: 256,
    allowEventBridgePublish: true,
    sqsConsumer: true,
  },
  shipmentsApi: {
    logicalName: "shipments-api",
    bundleName: "shipments-api",
    handler: "index.apiHandler",
    timeout: 15,
    memorySize: 256,
    allowEventBridgePublish: true,
  },
  shipmentsSqs: {
    logicalName: "shipments-sqs",
    bundleName: "shipments-sqs",
    handler: "index.sqsHandler",
    timeout: 30,
    memorySize: 256,
    allowEventBridgePublish: true,
    sqsConsumer: true,
  },
} as const;

export const queueDefinitions = [
  {
    name: "invoices-subscription",
    queueName: "invoices-events",
    detailTypes: ["order.priced"],
    lambdaKey: "invoicesSqs",
  },
  {
    name: "payments-subscription",
    queueName: "payments-events",
    detailTypes: ["order.created", "invoice.generated"],
    lambdaKey: "paymentsSqs",
  },
  {
    name: "shipments-subscription",
    queueName: "shipments-events",
    detailTypes: ["order.created", "payment.succeeded"],
    lambdaKey: "shipmentsSqs",
  },
] as const;

export const routeDefinitions = [
  {
    name: "orders-create",
    routeKey: "POST /v1/orders",
    lambdaKey: "ordersApi",
  },
  {
    name: "orders-get",
    routeKey: "GET /v1/orders/{orderId}",
    lambdaKey: "ordersApi",
  },
  {
    name: "invoice-get",
    routeKey: "GET /v1/orders/{orderId}/invoice",
    lambdaKey: "invoicesApi",
  },
  {
    name: "shipment-webhook",
    routeKey: "POST /v1/webhooks/shipment-status",
    lambdaKey: "shipmentsApi",
  },
] as const;
