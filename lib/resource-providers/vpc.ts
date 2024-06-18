import {Fn, Tags} from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import {IpProtocol, ISubnet, PrivateSubnet, Vpc} from 'aws-cdk-lib/aws-ec2';
import * as eks from "aws-cdk-lib/aws-eks";
import {ResourceContext, ResourceProvider} from "../spi";

/**
 * Interface for Mapping for fields such as Primary CIDR, Secondary CIDR, Secondary Subnet CIDR.
 */
interface VpcProps {
   primaryCidr?: string,
   secondaryCidr?: string,
   secondarySubnetCidrs?: string[],
   ipFamily?: string,
}

/**
 * VPC resource provider 
 */
export class VpcProvider implements ResourceProvider<ec2.IVpc> {
    readonly vpcId?: string;
    readonly primaryCidr?: string;
    readonly secondaryCidr?: string;
    readonly secondarySubnetCidrs?: string[];
    readonly ipFamily?: string;
    subnets?: ec2.ISubnet[];


    constructor(vpcId?: string, private vpcProps?: VpcProps) {
        this.vpcId = vpcId;
        this.primaryCidr = vpcProps?.primaryCidr;
        this.secondaryCidr = vpcProps?.secondaryCidr;
        this.secondarySubnetCidrs = vpcProps?.secondarySubnetCidrs;
        this.ipFamily = vpcProps?.ipFamily;
    }

    provide(context: ResourceContext): ec2.IVpc {
        const id = context.scope.node.id;
        let vpc = undefined;

        if (this.vpcId && this.vpcId !== eks.IpFamily.IP_V6) {
            if (this.vpcId === "default") {
                console.log(`looking up completely default VPC`);
                vpc = ec2.Vpc.fromLookup(context.scope, id + "-vpc", { isDefault: true });
            } else {
                console.log(`looking up non-default ${this.vpcId} VPC`);
                vpc = ec2.Vpc.fromLookup(context.scope, id + "-vpc", { vpcId: this.vpcId });
            }
        }

        if (vpc == null) {

            if (this.ipFamily && this.ipFamily == eks.IpFamily.IP_V6) {
                vpc = this.getIPv6VPC(context, id);
                return vpc;
            }
            // It will automatically divide the provided VPC CIDR range, and create public and private subnets per Availability Zone.
            // If VPC CIDR range is not provided, uses `10.0.0.0/16` as the range and creates public and private subnets per Availability Zone.
            // Network routing for the public subnets will be configured to allow outbound access directly via an Internet Gateway.
            // Network routing for the private subnets will be configured to allow outbound access via a set of resilient NAT Gateways (one per AZ).
            // Creates Secondary CIDR and Secondary subnets if passed.
            if (this.primaryCidr) {
                vpc = new ec2.Vpc(context.scope, id + "-vpc",{
                    ipAddresses: ec2.IpAddresses.cidr(this.primaryCidr)
                });    
            }
            else {
                vpc = new ec2.Vpc(context.scope, id + "-vpc");
            }
        }

        if (this.secondaryCidr) {
            this.createSecondarySubnets(context, id, vpc);
        }
    
        return vpc;
    }

    protected createSecondarySubnets(context: ResourceContext, id: string, vpc: ec2.IVpc) {
        const secondarySubnets: Array<PrivateSubnet> = [];
        const secondaryCidr = new ec2.CfnVPCCidrBlock(context.scope, id + "-secondaryCidr", {
            vpcId: vpc.vpcId,
            cidrBlock: this.secondaryCidr
        });
        secondaryCidr.node.addDependency(vpc);
        if (this.secondarySubnetCidrs) {
            for (let i = 0; i < vpc.availabilityZones.length; i++) {
                if (this.secondarySubnetCidrs[i]) {
                    secondarySubnets[i] = new ec2.PrivateSubnet(context.scope, id + "private-subnet-" + i, {
                        availabilityZone: vpc.availabilityZones[i],
                        cidrBlock: this.secondarySubnetCidrs[i],
                        vpcId: vpc.vpcId
                    });
                    secondarySubnets[i].node.addDependency(secondaryCidr);
                    context.add("secondary-cidr-subnet-" + i, {
                        provide(_context): ISubnet { return secondarySubnets[i]; }
                    });
                }
            }
            for (let secondarySubnet of secondarySubnets) {
                Tags.of(secondarySubnet).add("kubernetes.io/role/internal-elb", "1", { applyToLaunchedInstances: true });
                Tags.of(secondarySubnet).add("Name", `blueprint-construct-dev-PrivateSubnet-${secondarySubnet}`, { applyToLaunchedInstances: true });
            }
        }
    }

    public getIPv6VPC(context: ResourceContext, id: string):ec2.IVpc {
        const vpc = new ec2.Vpc(context.scope, id+"-vpc", { maxAzs: 2, natGateways: 1,
            ipProtocol: IpProtocol.DUAL_STACK, restrictDefaultSecurityGroup: false });
        const ipv6cidr = new ec2.CfnVPCCidrBlock(context.scope, id+"-CIDR6", {
            vpcId: vpc.vpcId,
            amazonProvidedIpv6CidrBlock: true,
        });
        let subnetcount = 0;
        let subnets = [...vpc.publicSubnets, ...vpc.privateSubnets];
        for ( let subnet of subnets) {
            // Wait for the ipv6 cidr to complete
            subnet.node.addDependency(ipv6cidr);
            this._associate_subnet_with_v6_cidr(subnetcount, subnet, vpc);
            subnetcount++;
        }
        this.subnets = subnets
        return vpc
    }

    _associate_subnet_with_v6_cidr(count: number, subnet: ec2.ISubnet, vpc: Vpc) {
        const cfnSubnet = subnet.node.defaultChild as ec2.CfnSubnet;
        cfnSubnet.ipv6CidrBlock = Fn.select(count, Fn.cidr(Fn.select(0, vpc.vpcIpv6CidrBlocks), 256, (128 - 64).toString()));
        cfnSubnet.assignIpv6AddressOnCreation = true;
    }

}

export class DirectVpcProvider implements ResourceProvider<ec2.IVpc> {
     constructor(readonly vpc: ec2.IVpc) { }

    provide(_context: ResourceContext): ec2.IVpc {
        return this.vpc;
    }    
}

/**
 * Direct import secondary subnet provider, based on a known subnet ID. 
 * Recommended method if secondary subnet id is known, as it avoids extra look-ups.
 */
export class LookupSubnetProvider implements ResourceProvider<ISubnet> {
    constructor(private subnetId: string) { }

    provide(context: ResourceContext): ec2.ISubnet {
        return ec2.Subnet.fromSubnetAttributes(context.scope, `${this.subnetId}-secondarysubnet`, {subnetId: this.subnetId});
    }
}
