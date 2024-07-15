import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { execSync } from "child_process";

export class CdkTestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new Table(this, `cdk_test_table`, {
      tableName: `cdk_test_table`,
      partitionKey: {
        name: "pk",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "sk",
        type: AttributeType.STRING,
      },

      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: "ttl",
    });

    table.addGlobalSecondaryIndex({
      indexName: "gs1",
      partitionKey: {
        type: AttributeType.STRING,
        name: "gs1pk",
      },
      sortKey: {
        type: AttributeType.STRING,
        name: "gs1sk",
      },
    });

    const dynamoPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        "dynamodb:Query",
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
      ],
      resources: [table.tableArn, `${table.tableArn}/index/*`],
    });

    const res = execSync("cd .. && npm run build");

    console.log(res.toString());

    const helloLambda = new lambda.Function(this, "cdk_test_lambda", {
      functionName: "cdk_test_lambda",
      code: lambda.Code.fromAsset("../dist"),
      initialPolicy: [dynamoPolicy],
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      environment: {
        TABLE_NAME: table.tableName,
      },
      logRetention: RetentionDays.ONE_DAY,
    });

    const api = new apigateway.LambdaRestApi(this, "cdk_test_api", {
      restApiName: "cdk_test_api",
      deployOptions: {
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
      },
      handler: helloLambda,
      proxy: true,
    });

    new cdk.CfnOutput(this, "cdk_test_api_url", {
      value: api.url,
    });

    new cdk.CfnOutput(this, "cdk_table_name", {
      value: table.tableName,
    });
  }
}
