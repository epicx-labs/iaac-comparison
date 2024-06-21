import * as pulumi from "@pulumi/pulumi";
import * as archive from "@pulumi/archive";
import * as aws from "@pulumi/aws";
import * as apigateway from "@pulumi/aws-apigateway";
import { execSync } from "child_process";

const assumeRole = aws.iam.getPolicyDocument({
  statements: [
    {
      effect: "Allow",
      principals: [
        {
          type: "Service",
          identifiers: ["lambda.amazonaws.com"],
        },
      ],
      actions: ["sts:AssumeRole"],
    },
  ],
});

const iamForLambda = new aws.iam.Role("pulumi_iam_for_lambda", {
  name: "pulumi_iam_for_lambda",
  assumeRolePolicy: assumeRole.then((assumeRole) => assumeRole.json),
});

new aws.iam.RolePolicyAttachment("pulumi_lambda_role_policy_attachment", {
  role: iamForLambda.name,
  policyArn: aws.iam.ManagedPolicies.AWSLambdaBasicExecutionRole,
});

// Create a DynamoDB table
const table = new aws.dynamodb.Table("pulumi_test_table", {
  attributes: [
    { name: "pk", type: "S" }, // Partition key
    { name: "sk", type: "S" }, // Sort key
    { name: "gs1pk", type: "S" }, // GSI partition key attribute
    { name: "gs1sk", type: "S" }, // GSI sort key attribute
  ],
  hashKey: "pk",
  rangeKey: "sk",
  billingMode: "PAY_PER_REQUEST",
  globalSecondaryIndexes: [
    {
      name: "gs1",
      hashKey: "gs1pk",
      rangeKey: "gs1sk",
      projectionType: "ALL",
    },
  ],
});

const dynamoPolicy = new aws.iam.Policy("pulumi_dynamodb_policy", {
  policy: pulumi
    .output({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "dynamodb:Query",
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
          ],
          Resource: [
            table.arn,
            pulumi.interpolate`${table.arn}/index/*`, // Grant access to all indexes of the table
          ],
        },
      ],
    })
    .apply(JSON.stringify),
});

new aws.iam.RolePolicyAttachment("pulumi_table_role_policy_attachment", {
  role: iamForLambda.name,
  policyArn: dynamoPolicy.arn,
});

const res = execSync("cd .. && npm run build");

console.log(res.toString());

const lambda = archive.getFile({
  type: "zip",
  sourceFile: "../dist/index.js",
  outputPath: "lambda_function_payload.zip",
});

const testLambda = new aws.lambda.Function("pulumi_test_lambda", {
  code: new pulumi.asset.FileArchive("lambda_function_payload.zip"),
  name: "lambda_function_name",
  role: iamForLambda.arn,
  handler: "index.handler",
  sourceCodeHash: lambda.then((lambda) => lambda.outputBase64sha256),
  runtime: aws.lambda.Runtime.NodeJS20dX,
  environment: {
    variables: {
      NODE_ENV: "production",
      TABLE_NAME: table.name,
    },
  },
});

const api = new apigateway.RestAPI("pulumi_test_api", {
  routes: [
    {
      path: "/{proxy+}",
      method: "ANY",
      eventHandler: testLambda,
      target: {
        type: "aws_proxy",
      },
    },
  ],
  stageName: "prod",
});

export const url = api.url;
export const tableName = table.name;
