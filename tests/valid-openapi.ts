// The shared valid OpenAPI document the rule tests start from and mutate in one spot
// (the port of `_valid_openapi` from the former Python tests).

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

/** A fresh copy on every call, so a test can mutate it freely. */
export function validOpenapi(): JsonObject {
  return JSON.parse(VALID_OPENAPI_JSON) as JsonObject;
}

const VALID_OPENAPI_JSON = `{
  "openapi": "3.0.3",
  "info": {
    "title": "Orders API",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "https://app.example.com"
    }
  ],
  "paths": {
    "/api/orders": {
      "post": {
        "operationId": "createOrder",
        "summary": "Create an order",
        "description": "Creates an order and returns its persisted representation.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateOrder"
              },
              "example": {
                "item_id": "item-example",
                "quantity": 1
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Order created",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Order"
                },
                "example": {
                  "id": "order-example",
                  "item_id": "item-example",
                  "quantity": 1
                }
              }
            }
          },
          "400": {
            "description": "Invalid order",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "bearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT"
      }
    },
    "schemas": {
      "CreateOrder": {
        "type": "object",
        "required": [
          "item_id",
          "quantity"
        ],
        "properties": {
          "item_id": {
            "type": "string"
          },
          "quantity": {
            "type": "integer",
            "minimum": 1
          }
        }
      },
      "Order": {
        "type": "object",
        "required": [
          "id",
          "item_id",
          "quantity"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "item_id": {
            "type": "string"
          },
          "quantity": {
            "type": "integer"
          }
        }
      },
      "Error": {
        "type": "object",
        "required": [
          "message"
        ],
        "properties": {
          "message": {
            "type": "string"
          }
        }
      }
    }
  }
}`;
