import * as fs from 'fs';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { SecretValue } from 'aws-cdk-lib';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Artifact, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { CodeBuildAction, GitHubSourceAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import {StackConfig} from "../stack_config";
import { BuildEnvironmentVariable, BuildEnvironmentVariableType, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Repository } from 'aws-cdk-lib/aws-ecr';


export class EcsLogGenerationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const stackConfig: StackConfig = JSON.parse(fs.readFileSync("stack_config.json", "utf8"));
    const service = stackConfig.Services[0];

    const ecrRepo = new Repository(this, "DummyServiceEcrRepo", {
      repositoryName: service.pipeline.ecrRepoName
    });
    const repoEnv = service.pipeline.codebuild.environmentVariables.find((variable) => {
      return variable.name == "REPOSITORY_URI"
    });
    if ( repoEnv != null ) repoEnv.value = ecrRepo.repositoryUri;
    
    const pipeline = new Pipeline(this, service.pipeline.name);

    const sourceOutput = new Artifact();
    pipeline.addStage({
      stageName: "Source",
      actions: [
        new GitHubSourceAction({
          actionName: "Github_Source",
          owner: service.pipeline.github.owner,
          repo: service.pipeline.github.repo,
          oauthToken: SecretValue.secretsManager(service.pipeline.github.secretName),
          output: sourceOutput,
          branch: "main"
        })
      ]
    });

    type BuildEnvVars = {
      [key:string]: BuildEnvironmentVariable
    };

    const envVars:BuildEnvVars = {};
    service.pipeline.codebuild.environmentVariables.forEach((variable) => {
      let t = BuildEnvironmentVariableType.PLAINTEXT;
      switch ( variable.type ) {
        case "SECRETS_MANAGER":
          t = BuildEnvironmentVariableType.SECRETS_MANAGER;
          break;
        case "PARAMETER_STORE":
          t = BuildEnvironmentVariableType.PARAMETER_STORE;
          break;
        default:
          t = BuildEnvironmentVariableType.PLAINTEXT
          break;
      }
      envVars[variable.name] = {
        value: variable.value,
        type: t
      }
    });

    const buildProject = new PipelineProject(this, "buildProject", {
      projectName: "build",
      environmentVariables: envVars,
      logging: {
        cloudWatch: {
          logGroup: new LogGroup(this, service.pipeline.logGroup),
          prefix: service.pipeline.logStream
        }
      },
      environment: {
        privileged: true
      }
    });
    ecrRepo.grantPullPush(buildProject.grantPrincipal);
    pipeline.addStage({
      stageName: "Build",
      actions: [
        new CodeBuildAction({
          actionName: "Build_Container",
          input: sourceOutput,
          project: buildProject
        })
      ]
    });

    /**
    const vpc = ec2.Vpc.fromLookup(this, "Vpc", {
      isDefault: true
    });

    const cluster = new Cluster(this, "Cluster", { vpc: vpc});
    cluster.addCapacity("DefaultCapacity", {
      instanceType: new ec2.InstanceType("t3.nano"),
      desiredCapacity: 2
    });
    **/
  }
}
