import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {
  lambdaArchitectures,
  lambdaBasicExecutionPolicyArn,
  lambdaRuntime,
  lambdaSqsExecutionPolicyArn,
  getArtifactPath,
} from "../runtime";
import { LambdaServiceArgs, LambdaServiceOutputs } from "../types";

export class LambdaService
  extends pulumi.ComponentResource
  implements LambdaServiceOutputs
{
  readonly lambda: aws.lambda.Function;
  readonly role: aws.iam.Role;

  constructor(
    name: string,
    args: LambdaServiceArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super("checkout:infra:LambdaService", name, {}, opts);

    const childResourceOptions: pulumi.CustomResourceOptions = {
      parent: this,
      aliases: [{ parent: pulumi.rootStackResource }],
    };

    this.role = new aws.iam.Role(
      `${args.logicalName}-role`,
      {
        assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
          Service: "lambda.amazonaws.com",
        }),
        tags: args.tags,
      },
      childResourceOptions,
    );

    new aws.iam.RolePolicyAttachment(
      `${args.logicalName}-logs`,
      {
        role: this.role.name,
        policyArn: lambdaBasicExecutionPolicyArn,
      },
      childResourceOptions,
    );

    if (args.sqsConsumer) {
      new aws.iam.RolePolicyAttachment(
        `${args.logicalName}-sqs`,
        {
          role: this.role.name,
          policyArn: lambdaSqsExecutionPolicyArn,
        },
        childResourceOptions,
      );
    }

    if (args.allowEventBridgePublish) {
      if (!args.eventBusArn) {
        throw new Error(
          `eventBusArn is required for LambdaService "${args.logicalName}" when allowEventBridgePublish is true`,
        );
      }

      new aws.iam.RolePolicy(
        `${args.logicalName}-put-events`,
        {
          role: this.role.id,
          policy: pulumi
            .all([args.eventBusArn])
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
        },
        childResourceOptions,
      );
    }

    this.lambda = new aws.lambda.Function(
      args.logicalName,
      {
        name: `${args.namePrefix}-${args.logicalName}`,
        role: this.role.arn,
        runtime: lambdaRuntime,
        architectures: lambdaArchitectures,
        handler: args.handler,
        timeout: args.timeout,
        memorySize: args.memorySize,
        code: new pulumi.asset.FileArchive(getArtifactPath(args.bundleName)),
        environment: {
          variables: args.environment,
        },
        tags: args.tags,
      },
      childResourceOptions,
    );

    this.registerOutputs({
      lambda: this.lambda,
      role: this.role,
    });
  }
}
