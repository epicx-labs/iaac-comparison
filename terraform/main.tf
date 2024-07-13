terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "5.58.0"
    }
  }

  required_version = ">= 1.2.0"
}

provider "aws" {
  region = "us-east-1"
}

resource "aws_dynamodb_table" "terraform_test_table" {
  name         = "terraform_test_table"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  global_secondary_index {
    name            = "gs1"
    hash_key        = "gs1pk"
    range_key       = "gs1sk"
    projection_type = "ALL"

  }

  attribute {
    name = "gs1pk"
    type = "S"
  }

  attribute {
    name = "gs1sk"
    type = "S"
  }
}

data "aws_iam_policy_document" "assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "tf_iam_for_lambda" {
  name               = "tf_iam_for_lambda"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
}

data "archive_file" "lambda" {
  type        = "zip"
  source_file = "../dist/index.js"
  output_path = "lambda_function_payload.zip"
}

resource "aws_lambda_function" "tf_test_lambda" {
  filename      = "lambda_function_payload.zip"
  function_name = "lambda_function_name"
  role          = aws_iam_role.tf_iam_for_lambda.arn
  handler       = "index.handler"

  source_code_hash = data.archive_file.lambda.output_base64sha256

  runtime = "nodejs20.x"

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.terraform_test_table.name
    }
  }
}



resource "aws_api_gateway_rest_api" "tf_test_api" {
  name        = "tf_test_api"
  description = "API Gateway for test Lambda function"
}


resource "aws_api_gateway_resource" "tf_proxy" {
  rest_api_id = aws_api_gateway_rest_api.tf_test_api.id
  parent_id   = aws_api_gateway_rest_api.tf_test_api.root_resource_id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "tf_proxy_method" {
  rest_api_id   = aws_api_gateway_rest_api.tf_test_api.id
  resource_id   = aws_api_gateway_resource.tf_proxy.id
  http_method   = "ANY"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "tf_proxy_integration" {
  rest_api_id = aws_api_gateway_rest_api.tf_test_api.id
  resource_id = aws_api_gateway_resource.tf_proxy.id
  http_method = aws_api_gateway_method.tf_proxy_method.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.tf_test_lambda.invoke_arn
}

resource "aws_api_gateway_deployment" "tf_test_api_deployment" {
  rest_api_id = aws_api_gateway_rest_api.tf_test_api.id
  stage_name  = "prod"

  depends_on = [
    aws_api_gateway_integration.tf_proxy_integration
  ]
}

resource "aws_lambda_permission" "tf_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.tf_test_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.tf_test_api.execution_arn}/*/*/{proxy+}"
}

resource "aws_iam_policy" "tf_lambda_dynamodb_policy" {
  name        = "tf_lambda_dynamodb_policy"
  description = "Policy for Lambda to access DynamoDB table"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
        ],
        Resource = [aws_dynamodb_table.terraform_test_table.arn, "${aws_dynamodb_table.terraform_test_table.arn}/index/*"],
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_dynamodb_attach" {
  role       = aws_iam_role.tf_iam_for_lambda.name
  policy_arn = aws_iam_policy.tf_lambda_dynamodb_policy.arn
}


output "table_name" {
  value = aws_dynamodb_table.terraform_test_table.name
}

output "api_url" {
  value = aws_api_gateway_deployment.tf_test_api_deployment.invoke_url
}

