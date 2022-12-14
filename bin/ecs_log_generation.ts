#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EcsLogGenerationStack } from '../lib/ecs_log_generation-stack';
import { StackConfig } from '../stack_config';
import * as fs from 'fs';
import { InitEcrRepoStack } from '../lib/init_ecr_repo-stack';
import { EcsClusterStack } from '../lib/ecs_cluster-stack';
import { FargateClusterStack} from '../lib/fargate_cluster-stack'
import { FargateLogGenerationStack } from '../lib/fargate_log_generation-stack';

const stackConfig: StackConfig = JSON.parse(fs.readFileSync("stack_config.json", "utf8"));
const app = new cdk.App();

new InitEcrRepoStack(app, 'InitEcrRepoStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }, 
}, stackConfig);

const clusterStack = new EcsClusterStack(app, "EcsClusterStack", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});
new EcsLogGenerationStack(app, 'EcsLogGenerationStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
}, stackConfig.Services[0], clusterStack.cluster);

const fargateClusterStack = new FargateClusterStack(app, "FargateClusterStack", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});
new FargateLogGenerationStack(app, 'FargateLogGenerationStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
}, stackConfig.Services[1], fargateClusterStack.cluster);