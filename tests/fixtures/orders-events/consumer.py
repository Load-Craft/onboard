"""Kafka consumer for the synthetic async fixture.

Consumes order events from the orders-events topic on the example cluster.
"""

from __future__ import annotations

import json

from aiokafka import AIOKafkaConsumer
from pydantic import BaseModel

KAFKA_BOOTSTRAP = 'kafka.example.com:9092'
ORDERS_EVENTS_TOPIC = 'orders-events'


class OrderEvent(BaseModel):
    """Event emitted by upstream systems when an order changes state."""

    messageType: str = 'orderEvent'
    order_id: str
    state: str


async def consume_order_events() -> None:
    consumer = AIOKafkaConsumer(
        ORDERS_EVENTS_TOPIC,
        bootstrap_servers=KAFKA_BOOTSTRAP,
        value_deserializer=lambda raw: json.loads(raw.decode('utf-8')),
    )
    await consumer.start()
    try:
        async for record in consumer:
            event = OrderEvent.model_validate(record.value)
            del event
    finally:
        await consumer.stop()
