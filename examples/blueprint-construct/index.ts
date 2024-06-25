import * as cdk from 'aws-cdk-lib';
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { CapacityType, KubernetesVersion, NodegroupAmiType } from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from "constructs";
import * as blueprints from '../../lib';
import { logger, userLog } from '../../lib/utils';
import * as team from '../teams';
import { CfnWorkspace } from 'aws-cdk-lib/aws-aps';

import * as eks from "aws-cdk-lib/aws-eks";
import {getEKSNodeIpv6PolicyDocument} from "../../lib";
const burnhamManifestDir = './examples/teams/team-burnham/';
const rikerManifestDir = './examples/teams/team-riker/';
const teamManifestDirList = [burnhamManifestDir, rikerManifestDir];
const blueprintID = 'blueprint-construct-dev';

export interface BlueprintConstructProps {
    /**
     * Id
     */
    id: string
}

export default class BlueprintConstruct {
    constructor(scope: Construct, props: cdk.StackProps) {

        blueprints.HelmAddOn.validateHelmVersions = true;
        blueprints.HelmAddOn.failOnVersionValidation = false;
        logger.settings.minLevel = 3; // info
        userLog.settings.minLevel = 2; // debug

        const teams: Array<blueprints.Team> = [
            new team.TeamPlatform(process.env.CDK_DEFAULT_ACCOUNT!)
        ];

        const nodeRole = new blueprints.CreateRoleProvider("blueprint-node-role", new iam.ServicePrincipal("ec2.amazonaws.com"),
        [
            iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKSWorkerNodePolicy"),
            iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryReadOnly"),
            iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        ],
            getEKSNodeIpv6PolicyDocument()
        );

        const ampWorkspaceName = "blueprints-amp-workspace";
        const ampWorkspace: CfnWorkspace = blueprints.getNamedResource(ampWorkspaceName);

        const apacheAirflowS3Bucket = new blueprints.CreateS3BucketProvider({
            id: 'apache-airflow-s3-bucket-id',
            s3BucketProps: { removalPolicy: cdk.RemovalPolicy.DESTROY }
        });
        const apacheAirflowEfs = new blueprints.CreateEfsFileSystemProvider({
            name: 'blueprints-apache-airflow-efs',
        });
        const metadataOptions =  {
            httpEndpoint: "enabled",
            httpProtocolIPv6: "enabled",
            httpPutResponseHopLimit: 2,
            httpTokens: "required"
        };
        const nodeClassSpec: blueprints.Ec2NodeClassSpec = {
            amiFamily: "AL2",
            subnetSelectorTerms: [{ tags: { "Name": `${blueprintID}/${blueprintID}-vpc/PrivateSubnet*` }}],
            securityGroupSelectorTerms: [{ tags: { "aws:eks:cluster-name": `${blueprintID}` }}],
            metadataOptions: metadataOptions
        };

        const nodePoolSpec: blueprints.NodePoolSpec = {
            labels: {
                type: "karpenter"
            },
            annotations: {
                "eks-blueprints/owner": "bugatha"
            },
            requirements: [
                { key: 'node.kubernetes.io/instance-type', operator: 'In', values: ["c5.large", "m5.large", "r5.large", "m5.xlarge"] },
                { key: 'topology.kubernetes.io/zone', operator: 'In', values: [`${props?.env?.region}a`,`${props?.env?.region}b`]},
                { key: 'kubernetes.io/arch', operator: 'In', values: ['amd64','arm64']},
                { key: 'karpenter.sh/capacity-type', operator: 'In', values: ['on-demand']},
            ],
            disruption: {
                consolidationPolicy: "WhenEmpty",
                consolidateAfter: "30s",
                expireAfter: "20m",
            }
        };
/*
        const addOns: Array<blueprints.ClusterAddOn> = [
            new blueprints.KubeRayAddOn(),
            new blueprints.addons.AwsLoadBalancerControllerAddOn(),
            new blueprints.addons.AppMeshAddOn(),
            new blueprints.addons.CalicoOperatorAddOn(),
            new blueprints.addons.CertManagerAddOn(),
            new blueprints.addons.KubeStateMetricsAddOn(),
            new blueprints.addons.PrometheusNodeExporterAddOn(),
            new blueprints.addons.AdotCollectorAddOn({
                namespace:'adot',
                version: 'auto'
            }),
            new blueprints.addons.AmpAddOn({
                ampPrometheusEndpoint: ampWorkspace.attrPrometheusEndpoint,
                namespace: 'adot'
            }),
            new blueprints.addons.XrayAdotAddOn({
                namespace: 'adot'
            }),
            new blueprints.addons.XrayAddOn(),
            // new blueprints.addons.CloudWatchAdotAddOn(),
            // new blueprints.addons.ContainerInsightsAddOn(),
            // new blueprints.addons.CloudWatchInsights(),
            new blueprints.addons.IstioBaseAddOn(),
            new blueprints.addons.IstioControlPlaneAddOn(),
            new blueprints.addons.IstioCniAddon(),
            new blueprints.addons.IstioIngressGatewayAddon(),
            new blueprints.addons.MetricsServerAddOn(),
            new blueprints.addons.SecretsStoreAddOn(),
            new blueprints.addons.ArgoCDAddOn(),
            new blueprints.addons.SSMAgentAddOn(),
            new blueprints.addons.NginxAddOn({
                values: {
                    controller: { service: { create: false } }
                }
            }),
            // new blueprints.addons.VeleroAddOn(),
            new blueprints.addons.CoreDnsAddOn(),
            new blueprints.addons.KubeProxyAddOn(),
            new blueprints.addons.OpaGatekeeperAddOn(),
            new blueprints.addons.AckAddOn({
                id: "s3-ack",
                createNamespace: true,
                skipVersionValidation: true,
                serviceName: blueprints.AckServiceName.S3
            }),
            new blueprints.addons.KarpenterAddOn({
                version: "v0.33.2",
                nodePoolSpec: nodePoolSpec,
                ec2NodeClassSpec: nodeClassSpec,
                interruptionHandling: true,
            }),
            new blueprints.addons.AwsNodeTerminationHandlerAddOn(),
            new blueprints.addons.KubeviousAddOn(),
            new blueprints.addons.EbsCsiDriverAddOn({
                version: "auto",
                kmsKeys: [
                  blueprints.getResource(
                    (context) =>
                      new kms.Key(context.scope, "ebs-csi-driver-key", {
                        alias: "ebs-csi-driver-key",
                      })
                  ),
                ],
                storageClass: "gp3",
            }),
            new blueprints.addons.EfsCsiDriverAddOn({
              replicaCount: 1,
              kmsKeys: [
                blueprints.getResource( context => new kms.Key(context.scope, "efs-csi-driver-key", { alias: "efs-csi-driver-key"})),
              ],
            }),
            new blueprints.addons.KedaAddOn({
                podSecurityContextFsGroup: 1001,
                securityContextRunAsGroup: 1001,
                securityContextRunAsUser: 1001,
                irsaRoles: ["CloudWatchFullAccess", "AmazonSQSFullAccess"]
            }),
            new blueprints.addons.AWSPrivateCAIssuerAddon(),
            // new blueprints.addons.JupyterHubAddOn({
            //     efsConfig: {
            //         pvcName: "efs-persist",
            //         removalPolicy: cdk.RemovalPolicy.DESTROY,
            //         capacity: '10Gi',
            //     },
            //     serviceType: blueprints.JupyterHubServiceType.CLUSTERIP,
            //     notebookStack: 'jupyter/datascience-notebook',
            //     values: { prePuller: { hook: { enabled: false }}}
            // }),
            new blueprints.EmrEksAddOn(),
            new blueprints.AwsBatchAddOn(),
            // Commenting due to conflicts with `CloudWatchLogsAddon`
            // new blueprints.AwsForFluentBitAddOn(),
            new blueprints.FluxCDAddOn(),
            new blueprints.GpuOperatorAddon({
                values:{
                    driver: {
                      enabled: true
                    },
                    mig: {
                      strategy: 'mixed'
                    },
                    devicePlugin: {
                      enabled: true,
                      version: 'v0.13.0'
                    },
                    migManager: {
                      enabled: true,
                      WITH_REBOOT: true
                    },
                    toolkit: {
                      version: 'v1.13.1-centos7'
                    },
                    operator: {
                      defaultRuntime: 'containerd'
                    },
                    gfd: {
                      version: 'v0.8.0'
                    }
                  }
            }),
            new blueprints.GrafanaOperatorAddon(),
            new blueprints.CloudWatchLogsAddon({
                logGroupPrefix: '/aws/eks/blueprints-construct-dev',
                logRetentionDays: 30
            }),
            new blueprints.ApacheAirflowAddOn({
                enableLogging: true,
                s3Bucket: 'apache-airflow-s3-bucket-provider',
                enableEfs: true,
                efsFileSystem: 'apache-airflow-efs-provider'
            }),
            new blueprints.ExternalsSecretsAddOn(),
            new blueprints.EksPodIdentityAgentAddOn(),
            new blueprints.NeuronDevicePluginAddOn(),
            new blueprints.NeuronMonitorAddOn()
        ];

        // Instantiated to for helm version check.
        new blueprints.ExternalDnsAddOn({
            hostedZoneResources: [ blueprints.GlobalResources.HostedZone ]
        });

 */
        const addOns: Array<blueprints.ClusterAddOn> = [
            new blueprints.addons.KarpenterAddOn({
                version: "v0.34.5",
                nodePoolSpec: nodePoolSpec,
                ec2NodeClassSpec: nodeClassSpec,
                interruptionHandling: true,
            }),
            new blueprints.addons.VpcCniAddOn({
                version: "v1.18.2-eksbuild.1",
                enableV6Egress: true,
            })
        ];
        const clusterProvider = new blueprints.GenericClusterProvider({
            version: KubernetesVersion.V1_29,
            tags: {
                "Name": "blueprints-example-cluster",
                "Type": "generic-cluster"
            },
            mastersRole: blueprints.getResource(context => {
                return new iam.Role(context.scope, 'AdminRole', { assumedBy: new iam.AccountRootPrincipal() });
            }),
            managedNodeGroups: [
                addGenericNodeGroup()
            ]
        });

        const executionRolePolicyStatement:iam. PolicyStatement [] = [
            new iam.PolicyStatement({
              resources: ['*'],
              actions: ['s3:*'],
            }),
            new iam.PolicyStatement({
              resources: ['*'],
              actions: ['glue:*'],
            }),
            new iam.PolicyStatement({
              resources: ['*'],
              actions: [
                'logs:*',
              ],
            }),
          ];

        const dataTeam: blueprints.EmrEksTeamProps = {
              name:'dataTeam',
              virtualClusterName: 'batchJob',
              virtualClusterNamespace: 'batchjob',
              createNamespace: true,
              executionRoles: [
                  {
                      executionRoleIamPolicyStatement: executionRolePolicyStatement,
                      executionRoleName: 'myBlueprintExecRole'
                  }
              ]
          };

        const batchTeam: blueprints.BatchEksTeamProps = {
            name: 'batch-a',
            namespace: 'aws-batch',
            envName: 'batch-a-comp-env',
            computeResources: {
                envType: blueprints.BatchEnvType.EC2,
                allocationStrategy: blueprints.BatchAllocationStrategy.BEST,
                priority: 10,
                minvCpus: 0,
                maxvCpus: 128,
                instanceTypes: ["m5", "c4.4xlarge"]
            },
            jobQueueName: 'team-a-job-queue',
        };

        /*
        .resourceProvider(blueprints.GlobalResources.Vpc, new blueprints.VpcProvider(undefined, {
                ipFamily: eks.IpFamily.IP_V6,
            }))
            .withBlueprintProps({
                ipFamily: eks.IpFamily.IP_V6,
            })
         */
        blueprints.EksBlueprint.builder()
            .addOns(...addOns)
            .resourceProvider(blueprints.GlobalResources.Vpc, new blueprints.VpcProvider(undefined, {
                ipFamily: eks.IpFamily.IP_V6,
            }))
            .withBlueprintProps({
                ipFamily: eks.IpFamily.IP_V6,
            })
            .teams(...teams)
            .resourceProvider("node-role", nodeRole)
            .clusterProvider(clusterProvider)
            .enableControlPlaneLogTypes(blueprints.ControlPlaneLogType.API)
            .build(scope, blueprintID, props);

    }
}



function addGenericNodeGroup(): blueprints.ManagedNodeGroup {
    return {
        id: "mng1",
        amiType: NodegroupAmiType.AL2_X86_64,
        instanceTypes: [new ec2.InstanceType('m6a.xlarge'), new ec2.InstanceType('m6i.xlarge')], //[ "m6i.xlarge", "m6a.xlarge" ]
        desiredSize: 2,
        maxSize: 3,
        tags: { complianceTech: "doNotMonitor" },
        nodeRole: blueprints.getNamedResource("node-role") as iam.Role,
        launchTemplate: {
            // You can pass Custom Tags to Launch Templates which gets Propogated to worker nodes.
            tags: {
                "Name": "Mng1",
                "Type": "Managed-Node-Group",
                "LaunchTemplate": "Custom",
                "Instance": "ONDEMAND"
            },
            requireImdsv2: true
        }
    };
}

function addCustomNodeGroup(): blueprints.ManagedNodeGroup {

    const userData = ec2.UserData.forLinux();
    userData.addCommands(`/etc/eks/bootstrap.sh ${blueprintID}`);

    return {
        id: "mng2-customami",
        amiType: NodegroupAmiType.AL2_X86_64,
        instanceTypes: [new ec2.InstanceType('t3.large')],
        nodeGroupCapacityType: CapacityType.SPOT,
        desiredSize: 0,
        minSize: 0,
        nodeRole: blueprints.getNamedResource("node-role") as iam.Role,
        launchTemplate: {
            tags: {
                "Name": "Mng2",
                "Type": "Managed-Node-Group",
                "LaunchTemplate": "Custom",
                "Instance": "SPOT"
            },
            machineImage: ec2.MachineImage.genericLinux({
                'eu-west-1': 'ami-00805477850d62b8c',
                'us-east-1': 'ami-08e520f5673ee0894',
                'us-west-2': 'ami-0403ff342ceb30967',
                'us-east-2': 'ami-07109d69738d6e1ee',
                'us-west-1': 'ami-07bda4b61dc470985',
                'us-gov-west-1': 'ami-0e9ebbf0d3f263e9b',
                'us-gov-east-1':'ami-033eb9bc6daf8bfb1'
            }),
            userData: userData,
        }
    };
}

function addWindowsNodeGroup(): blueprints.ManagedNodeGroup {

    return {
        id: "mng3-windowsami",
        amiType: NodegroupAmiType.WINDOWS_CORE_2019_X86_64,
        instanceTypes: [new ec2.InstanceType('m5.4xlarge')],
        desiredSize: 0,
        minSize: 0,
        nodeRole: blueprints.getNamedResource("node-role") as iam.Role,
        diskSize: 50,
        tags: {
            "Name": "Mng3",
            "Type": "Managed-WindowsNode-Group",
            "LaunchTemplate": "WindowsLT",
            "kubernetes.io/cluster/blueprint-construct-dev": "owned"
        }
    };
}

function addGpuNodeGroup(): blueprints.ManagedNodeGroup {

    return {
        id: "mng-linux-gpu",
        amiType: NodegroupAmiType.AL2_X86_64_GPU,
        instanceTypes: [new ec2.InstanceType('g5.xlarge')],
        desiredSize: 0,
        minSize: 0,
        maxSize: 1,
        nodeGroupSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        launchTemplate: {
            tags: {
                "Name": "Mng-linux-Gpu",
                "Type": "Managed-linux-Gpu-Node-Group",
                "LaunchTemplate": "Linux-Launch-Template",
            },
            requireImdsv2: false
        }
    };
}

export function addInferentiaNodeGroup(): blueprints.ManagedNodeGroup {

    return {
        id: "mng4-inferentia",
        instanceTypes: [new ec2.InstanceType('inf1.2xlarge')],
        desiredSize: 1,
        minSize: 1, 
        nodeRole: blueprints.getNamedResource("node-role") as iam.Role,
        diskSize: 50,
        tags: {
            "Name": "Mng4",
            "Type": "Managed-InferentiaNode-Group",
            "LaunchTemplate": "Inferentia",
            "kubernetes.io/cluster/blueprint-construct-dev": "owned"
        }
    };
}
