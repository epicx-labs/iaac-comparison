import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { Table } from "dynamodb-onetable";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";

console.log("hello");

const Item = {
  pk: { type: String, value: "${_type}#${id}" },
  sk: { type: String, value: "${_type}#" },
  id: {
    type: String,
    generate: "ulid",
    validate: /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/i,
  },
  name: { type: String, required: true },

  gs1pk: { type: String, value: "${_type}#" },
  gs1sk: { type: String, value: "${_type}#" },
};

const MySchema = {
  format: "onetable:1.1.0",
  version: "0.0.1",
  indexes: {
    primary: { hash: "pk", sort: "sk" },
    gs1: { hash: "gs1pk", sort: "gs1sk", follow: true },
  },
  models: {
    Item,
  },
  params: {
    isoDates: true,
    timestamps: true,
    createdField: "createdAt",
    updatedField: "updatedAt",
  },
};

const client = new DynamoDBClient();
const tableName = process.env.TABLE_NAME;

const table = new Table({
  client: client,
  name: tableName,
  schema: MySchema,
});

const app = new Hono().basePath("/api");

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.get("/item", async (c) => {
  try {
    const itemsModel = table.getModel("Item");
    const items = await itemsModel.find(
      {
        gs1sk: {
          begins_with: "Item#",
        },
      },
      {
        index: "gs1",
      },
    );

    return c.json(items);
  } catch (error: any) {
    return c.json(error);
  }
});

app.post("/item", async (c) => {
  try {
    const body = await c.req.json();
    const itemsModel = table.getModel("Item");
    const item = await itemsModel.create({
      name: body.name ?? "none",
    });

    return c.json(item);
  } catch (error: any) {
    return c.json(error);
  }
});

app.get("/item/:id", async (c) => {
  const id = c.req.param("id");
  // const data = await client.send(new GetItemCommand(params));

  // if (!data.Item) {
  //   return c.text("Item not found", 404);
  // }
  //
  // return c.json(data.Item);
});

app.all("*", async (c) => {
  return c.json({ path: c.req.path, url: c.req.url });
});

export const handler = handle(app);
