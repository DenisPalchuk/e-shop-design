import fs from "node:fs";
import path from "node:path";

export const lambdaBasicExecutionPolicyArn =
  "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole";
export const lambdaSqsExecutionPolicyArn =
  "arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole";
export const lambdaRuntime = "nodejs20.x";
export const lambdaArchitectures = ["arm64"];

const repoRoot = path.resolve(__dirname, "..");
const artifactRoot = path.join(repoRoot, "src", ".artifacts");

export function getArtifactPath(bundleName: string): string {
  const artifactPath = path.join(artifactRoot, bundleName);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `Lambda bundle "${bundleName}" was not found at ${artifactPath}. Run "npm run build:lambdas" from infra/ before deploying.`,
    );
  }

  return artifactPath;
}
