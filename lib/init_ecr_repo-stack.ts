import * as cdk from 'aws-cdk-lib';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import { StackConfig } from '../stack_config';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { env } from 'process';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { CfnOutput, cfnTagToCloudFormation } from 'aws-cdk-lib';

export class InitEcrRepoStack extends cdk.Stack {
 
    public readonly repos: Map<string, Repository>;

    constructor(scope: Construct, id: string, props: cdk.StackProps, config: StackConfig) {
      super(scope, id, props);

        const dockerhubSecretId = new cdk.CfnParameter(this, "dockerhubSecretId");
        const keyPairName = new cdk.CfnParameter(this, "keypair");

        this.repos = new Map<string, Repository>();
        config.Services.forEach((service) => {
            this.repos.set(service.serviceName, new Repository(this, service.serviceName));
        });

        const vpc = ec2.Vpc.fromLookup(this, "Vpc", {
            isDefault: true});

        const userData = ec2.UserData.forLinux();
        userData.addCommands(
            "sudo yum -y update",
            "sudo yum -y install git",
            "sudo yum -y install docker",
            "sudo yum -y install jq",
            "sudo systemctl start docker",
            "sudo $(aws ecr get-login --no-include-email --region " + this.region + ")",
            "export DOCKERHUB_USERNAME=$(aws secretsmanager get-secret-value --region " + this.region + 
            " --secret-id " + dockerhubSecretId.valueAsString + " --query SecretString --output text | jq -r .username)",
            "export DOCKERHUB_PASSWORD=$(aws secretsmanager get-secret-value --region " + this.region + 
            " --secret-id " + dockerhubSecretId.valueAsString + " --query SecretString --output text | jq -r .password)",
            "echo ${DOCKERHUB_PASSWORD} | sudo docker login -u ${DOCKERHUB_USERNAME} --password-stdin"
        );

        config.Services.forEach((service) => {
            userData.addCommands("git clone " + service.pipeline.github.cloneUrl);
            userData.addCommands("cd " + service.pipeline.github.repo);
            userData.addCommands("sudo docker build -t " + this.repos.get(service.serviceName)?.repositoryUriForTag("latest") + " .");
            userData.addCommands("sudo docker push " + this.repos.get(service.serviceName)?.repositoryUriForTag("latest"));
        });

        config.Tasks.forEach((task) => {
            userData.addCommands("git clone " + task.pipeline.github.cloneUrl);
            userData.addCommands("cd " + task.pipeline.github.repo);
            userData.addCommands("sudo docker build -t " + this.repos.get(task.taskName)?.repositoryUriForTag("latest") + " .");
            userData.addCommands("sudo docker push " + this.repos.get(task.taskName)?.repositoryUriForTag("latest"));
        });

        const instance = new ec2.Instance(this, 'DockerBuildInstance', {
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
            machineImage: new ec2.AmazonLinuxImage({
                generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2
            }),
            vpc: vpc,
            vpcSubnets: { 
                subnetType: ec2.SubnetType.PUBLIC
            },
            userData: userData,
            keyName: keyPairName.valueAsString,
        });
        instance.connections.allowFromAnyIpv4(ec2.Port.tcp(22));

        this.repos.forEach((repo) => {
            repo.grantPullPush(instance);
        });

        Secret.fromSecretNameV2(this, "DockerhubSecret", dockerhubSecretId.valueAsString).grantRead(instance);

        config.Services.forEach((service) => {
            let repo = this.repos.get(service.serviceName);
            if ( repo != null ) {
                new CfnOutput(this, service.serviceName + "_RepoName", {
                    value: repo.repositoryName
                })
            }
        });

        config.Tasks.forEach((task) => {
            let repo = this.repos.get(task.taskName);
            if ( repo != null ) {
                new CfnOutput(this, task.taskName + "_RepoName", {
                    value: repo.repositoryName
                })
            }
        });
    }
}