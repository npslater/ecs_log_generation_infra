import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { SecretValue } from 'aws-cdk-lib';
import { Artifact, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { CodeBuildAction, EcsDeployAction, GitHubSourceAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { BuildEnvironmentVariable, BuildEnvironmentVariableType, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Cluster, ContainerImage } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { Service } from '../stack_config';
import * as ecs from "aws-cdk-lib/aws-ecs";


export class FargateLogGenerationStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props: cdk.StackProps, service: Service, cluster:Cluster) {
    super(scope, id, props);

      const ecrRepo = Repository.fromRepositoryName(this, "EcrRepo", service.pipeline.ecrRepoName);
      const repoEnv = service.pipeline.codebuild.environmentVariables.find((variable) => {
        return variable.name == "REPOSITORY_URI"
      });
      if ( repoEnv != null ) repoEnv.value = ecrRepo.repositoryUri;


      const loadBalancedService = new ApplicationLoadBalancedFargateService(this, service.serviceName, {
        cluster,
        memoryLimitMiB: 512,
        cpu:256,
        taskImageOptions: {
            image: ContainerImage.fromEcrRepository(ecrRepo),
            enableLogging: true,
            logDriver: new ecs.AwsLogDriver({streamPrefix: service.serviceName})
        },
        desiredCount: 4,
        platformVersion: ecs.FargatePlatformVersion.VERSION1_3,
        assignPublicIp:true
      });
      ecrRepo.grantPull(loadBalancedService.taskDefinition.obtainExecutionRole());


      const serviceResourceEnv = service.pipeline.codebuild.environmentVariables.find((variable) => {
        return variable.name == "CONTAINER_NAME"
      });

      if ( serviceResourceEnv != null ) {
        if ( loadBalancedService.taskDefinition.defaultContainer?.containerName != null )
          serviceResourceEnv.value =loadBalancedService.taskDefinition.defaultContainer?.containerName;
        else
          serviceResourceEnv.value = "web";
      }

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

      const buildOutput = [new Artifact()];
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
            project: buildProject,
            outputs: buildOutput
          })
        ]
      });

      pipeline.addStage({
        stageName: "Deploy",
        actions: [
            new EcsDeployAction({
            service: loadBalancedService.service,
            actionName: "DeployEcs",
            input: buildOutput[0]
        })]
      });

  }  //end constructor
} //end module
