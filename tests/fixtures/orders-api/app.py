"""Synthetic API repository used to forward-test the customer skill."""

from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field


class CreateOrder(BaseModel):
    item_id: str = Field(min_length=1)
    quantity: int = Field(ge=1, le=100)


class Order(BaseModel):
    id: str
    item_id: str
    quantity: int
    state: str


class ApiError(BaseModel):
    message: str


async def require_user(
    authorization: Annotated[str, Header(description="Bearer test credential")],
) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return "user-example"


app = FastAPI(title="Orders API", version="1.0.0", servers=[{"url": "https://app.example.com"}])


@app.post(
    "/api/orders",
    operation_id="createOrder",
    response_model=Order,
    status_code=status.HTTP_201_CREATED,
    responses={
        400: {"model": ApiError, "description": "Invalid order"},
        401: {"model": ApiError, "description": "Authentication required"},
    },
)
async def create_order(
    order: CreateOrder,
    user_id: Annotated[str, Depends(require_user)],
) -> Order:
    del user_id
    return Order(
        id="order-example",
        item_id=order.item_id,
        quantity=order.quantity,
        state="CREATED",
    )


@app.get(
    "/api/orders/{order_id}",
    operation_id="getOrder",
    response_model=Order,
    responses={
        401: {"model": ApiError, "description": "Authentication required"},
        404: {"model": ApiError, "description": "Order not found"},
    },
)
async def get_order(
    order_id: str,
    user_id: Annotated[str, Depends(require_user)],
) -> Order:
    del user_id
    if order_id == "missing":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return Order(id=order_id, item_id="item-example", quantity=1, state="CREATED")
