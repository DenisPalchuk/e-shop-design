import * as mongodbatlas from "@pulumi/mongodbatlas";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { InfraConfig, AtlasResources } from "./types";

export function createAtlasResources(config: InfraConfig): AtlasResources {
  const atlasProvider = new mongodbatlas.Provider("atlas", {
    publicKey: config.atlasPublicKey,
    privateKey: config.atlasPrivateKey,
  });

  const atlasProject = new mongodbatlas.Project(
    "atlas-project",
    {
      orgId: config.atlasOrgId,
      name: config.atlasProjectName,
    },
    { provider: atlasProvider },
  );

  const atlasAccessList = new mongodbatlas.ProjectIpAccessList(
    "atlas-access-list",
    {
      projectId: atlasProject.id,
      cidrBlock: config.atlasAccessListCidr,
      comment: "Public Lambda egress for the checkout dev stack",
    },
    { provider: atlasProvider },
  );

  const atlasCluster = new mongodbatlas.AdvancedCluster(
    "atlas-cluster",
    {
      projectId: atlasProject.id,
      name: config.atlasClusterName,
      clusterType: "REPLICASET",
      replicationSpecs: [
        {
          regionConfigs: [
            {
              providerName: "TENANT",
              backingProviderName: "AWS",
              regionName: config.atlasRegion,
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
      username: config.atlasDbUsername,
      password: dbPassword.result,
      authDatabaseName: "admin",
      roles: [
        {
          roleName: "readWrite",
          databaseName: config.atlasDatabaseName,
        },
      ],
    },
    { provider: atlasProvider },
  );

  const mongoSrv = atlasCluster.connectionStrings.apply((connectionStrings: any) => {
    const srv = connectionStrings?.standardSrv ?? connectionStrings?.standard_srv;
    if (!srv) {
      throw new Error("MongoDB Atlas did not return a standard SRV connection string.");
    }
    return srv as string;
  });

  const mongoUri = pulumi.all([mongoSrv, dbPassword.result]).apply(([srv, password]) => {
    const url = new URL(srv);
    url.username = config.atlasDbUsername;
    url.password = password;
    url.pathname = `/${config.atlasDatabaseName}`;
    url.searchParams.set("retryWrites", "true");
    url.searchParams.set("w", "majority");
    url.searchParams.set("appName", `${config.namePrefix}-lambda`);
    return url.toString();
  });

  return {
    projectId: atlasProject.id,
    clusterName: atlasCluster.name,
    dbUsername: atlasDbUser.username,
    mongoSrv,
    mongoUri,
  };
}
