import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { QueueSubscriptionArgs, QueueSubscriptionOutputs } from "../types";

export class QueueSubscription
  extends pulumi.ComponentResource
  implements QueueSubscriptionOutputs
{
  readonly queue: aws.sqs.Queue;
  readonly dlq: aws.sqs.Queue;
  readonly rule: aws.cloudwatch.EventRule;

  constructor(
    name: string,
    args: QueueSubscriptionArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super("checkout:infra:QueueSubscription", name, {}, opts);

    const childResourceOptions: pulumi.CustomResourceOptions = {
      parent: this,
      aliases: [{ parent: pulumi.rootStackResource }],
    };

    this.dlq = new aws.sqs.Queue(
      `${args.queueName}-dlq`,
      {
        name: `${args.namePrefix}-${args.queueName}-dlq`,
        messageRetentionSeconds: 1_209_600,
        tags: args.tags,
      },
      childResourceOptions,
    );

    this.queue = new aws.sqs.Queue(
      args.queueName,
      {
        name: `${args.namePrefix}-${args.queueName}`,
        visibilityTimeoutSeconds: 180,
        redrivePolicy: pulumi.interpolate`{"deadLetterTargetArn":"${this.dlq.arn}","maxReceiveCount":3}`,
        tags: args.tags,
      },
      childResourceOptions,
    );

    this.rule = new aws.cloudwatch.EventRule(
      `${args.queueName}-rule`,
      {
        name: `${args.namePrefix}-${args.queueName}-rule`,
        eventBusName: args.eventBus.name,
        eventPattern: JSON.stringify({
          "detail-type": args.detailTypes,
        }),
        tags: args.tags,
      },
      childResourceOptions,
    );

    new aws.sqs.QueuePolicy(
      `${args.queueName}-policy`,
      {
        queueUrl: this.queue.id,
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
                resources: [this.queue.arn],
                conditions: [
                  {
                    test: "ArnEquals",
                    variable: "aws:SourceArn",
                    values: [this.rule.arn],
                  },
                ],
              },
            ],
          })
          .json,
      },
      childResourceOptions,
    );

    new aws.cloudwatch.EventTarget(
      `${args.queueName}-target`,
      {
        eventBusName: args.eventBus.name,
        rule: this.rule.name,
        arn: this.queue.arn,
      },
      childResourceOptions,
    );

    new aws.lambda.EventSourceMapping(
      `${args.queueName}-mapping`,
      {
        eventSourceArn: this.queue.arn,
        functionName: args.targetLambda.arn,
        batchSize: args.batchSize ?? 5,
        maximumBatchingWindowInSeconds: 5,
      },
      childResourceOptions,
    );

    this.registerOutputs({
      queue: this.queue,
      dlq: this.dlq,
      rule: this.rule,
    });
  }
}
