import * as cdk from 'aws-cdk-lib';
import { Cluster } from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class FargateClusterStack extends cdk.Stack {
    
    public readonly cluster: Cluster;
    
    constructor(scope: Construct, id: string, props: cdk.StackProps) {
        super(scope, id, props);

        const vpc = ec2.Vpc.fromLookup(this, "Vpc", {
            isDefault: true});
      
        this.cluster = new Cluster(this, "Cluster", { vpc: vpc});
    }
}