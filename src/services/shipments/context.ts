import { getDb } from "../../shared/db";
import { getEventBridgeClient, DEFAULT_BUS_NAME } from "../../shared/eventbridge";
import { Logger } from "../../shared/logger";
import { ShipmentRepository } from "./repositories/shipment.repository";
import { OrderProjectionRepository } from "./repositories/order-projection.repository";
import { ShipmentEvents } from "./events/shipment.events";
import { IShippingProvider } from "./providers/shipping-provider.interface";
import { MockDhlProvider } from "./providers/mock-dhl.provider";
import { CircuitBreaker } from "./circuit-breaker";

export interface ShipmentsContext {
  shipmentRepository: ShipmentRepository;
  orderProjectionRepository: OrderProjectionRepository;
  shipmentEvents: ShipmentEvents;
  shippingProvider: IShippingProvider;
  circuitBreaker: CircuitBreaker;
}

export async function init(logger: Logger): Promise<ShipmentsContext> {
  const db = await getDb();

  const shipmentRepository = new ShipmentRepository(db, logger);
  await shipmentRepository.ensureIndexes();

  return {
    shipmentRepository,
    orderProjectionRepository: new OrderProjectionRepository(db, logger),
    shipmentEvents: new ShipmentEvents(
      process.env.EVENTBRIDGE_BUS_NAME ?? DEFAULT_BUS_NAME,
      getEventBridgeClient(),
      logger,
    ),
    shippingProvider: new MockDhlProvider(),
    circuitBreaker: new CircuitBreaker("dhl", db, logger),
  };
}
