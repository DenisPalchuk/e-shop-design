import * as pulumi from "@pulumi/pulumi";
import { InfraConfig } from "./types";

function getConfigOrEnv(
  config: pulumi.Config,
  name: string,
  envName: string,
  fallback?: string,
): string {
  const value = config.get(name) ?? process.env[envName] ?? fallback;
  if (!value) {
    throw new Error(
      `Missing required configuration "${name}" or environment variable "${envName}"`,
    );
  }
  return value;
}

function getSecretConfigOrEnv(
  config: pulumi.Config,
  name: string,
  envName: string,
): pulumi.Input<string> {
  const secretValue = config.getSecret(name);
  if (secretValue) {
    return secretValue;
  }

  const envValue = process.env[envName];
  if (!envValue) {
    throw new Error(
      `Missing required secret "${name}" or environment variable "${envName}"`,
    );
  }

  return pulumi.secret(envValue);
}

export function getInfraConfig(): InfraConfig {
  const config = new pulumi.Config();
  const stack = pulumi.getStack();

  return {
    stack,
    atlasOrgId: getConfigOrEnv(config, "atlasOrgId", "ATLAS_ORG_ID"),
    atlasProjectName: getConfigOrEnv(
      config,
      "atlasProjectName",
      "ATLAS_PROJECT_NAME",
      `e-shop-checkout-${stack}`,
    ),
    atlasClusterName: getConfigOrEnv(
      config,
      "atlasClusterName",
      "ATLAS_CLUSTER_NAME",
      "checkout-free",
    ),
    atlasDatabaseName: getConfigOrEnv(
      config,
      "atlasDatabaseName",
      "ATLAS_DATABASE_NAME",
      "ecommerce",
    ),
    atlasDbUsername: getConfigOrEnv(
      config,
      "atlasDbUsername",
      "ATLAS_DB_USERNAME",
      "checkoutapp",
    ),
    atlasRegion: getConfigOrEnv(
      config,
      "atlasRegion",
      "ATLAS_REGION",
      "US_EAST_1",
    ),
    atlasAccessListCidr: getConfigOrEnv(
      config,
      "atlasAccessListCidr",
      "ATLAS_ACCESS_LIST_CIDR",
      "0.0.0.0/0",
    ),
    eventBusName: getConfigOrEnv(
      config,
      "eventBusName",
      "EVENTBRIDGE_BUS_NAME",
      "checkout-events",
    ),
    namePrefix: getConfigOrEnv(
      config,
      "namePrefix",
      "RESOURCE_NAME_PREFIX",
      `checkout-${stack}`,
    ),
    atlasPublicKey: getSecretConfigOrEnv(
      config,
      "atlasPublicKey",
      "MONGODB_ATLAS_PUBLIC_KEY",
    ),
    atlasPrivateKey: getSecretConfigOrEnv(
      config,
      "atlasPrivateKey",
      "MONGODB_ATLAS_PRIVATE_KEY",
    ),
    tags: {
      Project: "e-shop-design",
      Stack: stack,
      ManagedBy: "Pulumi",
    },
  };
}
