import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import * as logs from '@aws-cdk/aws-logs';

export interface AmundsenStackProps extends cdk.StackProps {
  /*
   * A cidr to add to the security group to allow access to your ecs instance
   */
  allowedCidr: string;
}

export class AmundsenStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: AmundsenStackProps) {
    super(scope, id, props);

    const cluster = new ecs.Cluster(this, 'Cluster');

    const clusterAsg = cluster.addCapacity('DefaultAutoScalingGroupCapacity', {
      instanceType: new ec2.InstanceType('t3.xlarge'),
      desiredCapacity: 1,
      associatePublicIpAddress: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    clusterAsg.addUserData(`sysctl -w vm.max_map_count=262144`);
    clusterAsg.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
    const sg = new ec2.SecurityGroup(this, 'clusterSG', {
      vpc: cluster.vpc,
    });
    sg.addIngressRule(ec2.Peer.ipv4(props.allowedCidr), ec2.Port.allTcp());
    clusterAsg.addSecurityGroup(sg);

    const serviceDefinition = new ecs.Ec2TaskDefinition(this, 'TaskDef', {
      networkMode: ecs.NetworkMode.BRIDGE,
    });

    const neo4j = serviceDefinition.addContainer('neo4j', {
      memoryLimitMiB: 3072,
      hostname: 'neo4jamundsen',
      cpu: 128,
      image: ecs.ContainerImage.fromRegistry('neo4j:3.5'),
      environment: {
        NEO4J_AUTH: 'neo4j/test',
        'NEO4J_dbms.active_database': 'amundsen.db',
        'NEO4J_dbms.directories.data': '/neo4j/data',
        'NEO4J_dbms.directories.logs': '/var/log/neo4j',
        'NEO4J_dbms.directories.import': '/var/lib/neo4j/import',
        'NEO4J_dbms.security.auth_enabled': 'false',
        'NEO4J_dbms.connectors.default_listen_address': '0.0.0.0',
      },
      logging: new ecs.AwsLogDriver({
        logGroup: new logs.LogGroup(this, 'amundsen-neo4j'),
        streamPrefix: 'amundsen-neo4j',
      }),
    });
    neo4j.addUlimits({ hardLimit: 40000, softLimit: 40000, name: ecs.UlimitName.NOFILE });
    neo4j.addPortMappings({
      containerPort: 7687,
      hostPort: 7687,
    });
    neo4j.addPortMappings({
      containerPort: 7474,
      hostPort: 7474,
    });

    const elasticsearch = serviceDefinition.addContainer('elasticsearch', {
      hostname: 'esamundsen',
      memoryLimitMiB: 3072,
      cpu: 128,
      image: ecs.ContainerImage.fromRegistry('elasticsearch:6.8.13'),
      logging: new ecs.AwsLogDriver({
        logGroup: new logs.LogGroup(this, 'amundsen-elasticsearch'),
        streamPrefix: 'amundsen-elasticsearch',
      }),
    });
    elasticsearch.addUlimits({ hardLimit: 65536, softLimit: 65536, name: ecs.UlimitName.NOFILE });
    elasticsearch.addPortMappings({
      containerPort: 9200,
      hostPort: 9200,
    });

    const amundsensearch = serviceDefinition.addContainer('amundsensearch', {
      hostname: 'amundsensearch',
      memoryLimitMiB: 500,
      cpu: 128,
      image: ecs.ContainerImage.fromRegistry('amundsendev/amundsen-search:latest'),
      logging: new ecs.AwsLogDriver({
        logGroup: new logs.LogGroup(this, 'amundsensearch'),
        streamPrefix: 'amundsensearch',
      }),
      environment: {
        PROXY_ENDPOINT: 'esamundsen',
      },
    });
    amundsensearch.addContainerDependencies({
      container: elasticsearch,
      condition: ecs.ContainerDependencyCondition.START,
    });
    amundsensearch.addPortMappings({
      containerPort: 5000,
      hostPort: 5001,
    });

    const amundsenmetadata = serviceDefinition.addContainer('amundsenmetadata', {
      hostname: 'amundsenmetadata',
      memoryLimitMiB: 500,
      cpu: 128,
      image: ecs.ContainerImage.fromRegistry('amundsendev/amundsen-metadata:latest'),
      logging: new ecs.AwsLogDriver({
        logGroup: new logs.LogGroup(this, 'amundsenmetadata'),
        streamPrefix: 'amundsenmetadata',
      }),
      environment: {
        PROXY_HOST: 'bolt://neo4jamundsen',
      },
    });
    amundsenmetadata.addContainerDependencies({ container: neo4j, condition: ecs.ContainerDependencyCondition.START });
    amundsenmetadata.addPortMappings({
      containerPort: 5000,
      hostPort: 5002,
    });

    const amundsenfrontend = serviceDefinition.addContainer('amundsenfrontend', {
      hostname: 'amundsenfrontend',
      image: ecs.ContainerImage.fromRegistry('amundsendev/amundsen-frontend:latest'),
      logging: new ecs.AwsLogDriver({
        logGroup: new logs.LogGroup(this, 'amundsenfrontend'),
        streamPrefix: 'amundsenfrontend',
      }),
      environment: {
        SEARCHSERVICE_BASE: 'http://amundsensearch:5001',
        METADATASERVICE_BASE: 'http://amundsenmetadata:5002',
        FRONTEND_SVC_CONFIG_MODULE_CLASS: 'amundsen_application.config.TestConfig',
      },
      memoryLimitMiB: 500,
      cpu: 128,
    });
    amundsenfrontend.addContainerDependencies({
      container: amundsenmetadata,
      condition: ecs.ContainerDependencyCondition.START,
    });
    amundsenfrontend.addContainerDependencies({
      container: amundsensearch,
      condition: ecs.ContainerDependencyCondition.START,
    });
    amundsenfrontend.addPortMappings({
      containerPort: 5000,
      hostPort: 5000,
    });

    amundsenfrontend.addLink(amundsenmetadata);
    amundsenfrontend.addLink(amundsensearch);
    amundsenfrontend.addLink(elasticsearch);
    amundsenfrontend.addLink(neo4j);
    amundsenmetadata.addLink(amundsensearch);
    amundsenmetadata.addLink(elasticsearch);
    amundsenmetadata.addLink(neo4j);
    amundsensearch.addLink(elasticsearch);
    amundsensearch.addLink(neo4j);
    neo4j.addLink(elasticsearch);

    new ecs.Ec2Service(this, 'Service', {
      cluster,
      taskDefinition: serviceDefinition,
    });
  }
}
