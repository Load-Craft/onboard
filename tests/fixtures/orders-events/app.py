"""Synthetic async API repository used to forward-test the customer skill.

WebSocket surface: clients connect to /ws/orders, submit order commands and
receive order status updates. Deployed behind ws://app.example.com/ws/orders.
"""

from __future__ import annotations

from typing import Literal

from fastapi import FastAPI, WebSocket
from pydantic import BaseModel, Field

WS_PUBLIC_URL = 'ws://app.example.com/ws/orders'


class OrderCommand(BaseModel):
    """Command sent by a connected client to place an order."""

    messageType: Literal['orderCommand'] = 'orderCommand'
    item_id: str = Field(min_length=1)
    quantity: int = Field(ge=1, le=100)


class OrderStatus(BaseModel):
    """Status update pushed by the application to the connected client."""

    messageType: Literal['orderStatus'] = 'orderStatus'
    order_id: str
    state: str


app = FastAPI(title='Orders Events', version='1.0.0')


@app.websocket('/ws/orders')
async def orders_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    while True:
        raw = await websocket.receive_json()
        command = OrderCommand.model_validate(raw)
        status = OrderStatus(order_id='order-example', state='CREATED')
        del command
        await websocket.send_json(status.model_dump())
