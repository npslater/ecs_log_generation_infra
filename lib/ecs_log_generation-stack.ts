import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { SecretValue } from 'aws-cdk-lib';
import { Artifact, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { CodeBuildAction, EcsDeployAction, GitHubSourceAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { BuildEnvironmentVariable, BuildEnvironmentVariableType, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Cluster, ContainerImage } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedEc2Service } from 'aws-cdk-lib/aws-ecs-patterns';
import { StackConfig } from '../stack_config';


export class EcsLogGenerationStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props: cdk.StackProps, config: StackConfig, cluster:Cluster) {
    super(scope, id, props);

    config.Services.forEach((service) => {
      
      const ecrRepo = Repository.fromRepositoryName(this, "EcrRepo", service.pipeline.ecrRepoName);
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

      const loadBalancedService = new ApplicationLoadBalancedEc2Service(this, service.serviceName, {
        cluster,
        memoryLimitMiB: 128,
        taskImageOptions: {
            image: ContainerImage.fromEcrRepository(ecrRepo)
        },
        desiredCount: 1
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

    }); //end of forEach
  }  //end constructor
} //end module
