import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { HttpApiArgs, HttpApiOutputs } from "../types";

export class HttpApi extends pulumi.ComponentResource implements HttpApiOutputs {
  readonly api: aws.apigatewayv2.Api;
  readonly stage: aws.apigatewayv2.Stage;
  readonly invokeUrl: pulumi.Output<string>;

  constructor(name: string, args: HttpApiArgs, opts?: pulumi.ComponentResourceOptions) {
    super("checkout:infra:HttpApi", name, {}, opts);

    const childResourceOptions: pulumi.CustomResourceOptions = {
      parent: this,
      aliases: [{ parent: pulumi.rootStackResource }],
    };

    this.api = new aws.apigatewayv2.Api(
      args.logicalName,
      {
        name: `${args.namePrefix}-http-api`,
        protocolType: "HTTP",
        tags: args.tags,
      },
      childResourceOptions,
    );

    this.stage = new aws.apigatewayv2.Stage(
      "checkout-http-api-stage",
      {
        apiId: this.api.id,
        name: "$default",
        autoDeploy: true,
        tags: args.tags,
      },
      childResourceOptions,
    );

    for (const route of args.routes) {
      const integration = new aws.apigatewayv2.Integration(
        `${route.name}-integration`,
        {
          apiId: this.api.id,
          integrationType: "AWS_PROXY",
          integrationMethod: "POST",
          integrationUri: route.lambdaFunction.invokeArn,
          payloadFormatVersion: "2.0",
        },
        childResourceOptions,
      );

      new aws.apigatewayv2.Route(
        `${route.name}-route`,
        {
          apiId: this.api.id,
          routeKey: route.routeKey,
          target: pulumi.interpolate`integrations/${integration.id}`,
        },
        childResourceOptions,
      );

      new aws.lambda.Permission(
        `${route.name}-permission`,
        {
          action: "lambda:InvokeFunction",
          function: route.lambdaFunction.name,
          principal: "apigateway.amazonaws.com",
          sourceArn: pulumi.interpolate`${this.api.executionArn}/*/*`,
        },
        childResourceOptions,
      );
    }

    this.invokeUrl = this.stage.invokeUrl;

    this.registerOutputs({
      api: this.api,
      stage: this.stage,
      invokeUrl: this.invokeUrl,
    });
  }
}
