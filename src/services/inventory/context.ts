import { getDb } from "../../shared/db";
import { getEventBridgeClient, DEFAULT_BUS_NAME } from "../../shared/eventbridge";
import { Logger } from "../../shared/logger";
import { InventoryRepository } from "./repositories/inventory.repository";
import { InventoryEvents } from "./events/inventory.events";
import { IInventoryProvider } from "./providers/inventory-provider.interface";
import { MockInventoryProvider } from "./providers/mock/mock-inventory.provider";

export interface InventoryContext {
  inventoryRepository: InventoryRepository;
  inventoryEvents: InventoryEvents;
  inventoryProvider: IInventoryProvider;
}

export async function init(logger: Logger): Promise<InventoryContext> {
  const db = await getDb();

  return {
    inventoryRepository: new InventoryRepository(db, logger),
    inventoryEvents: new InventoryEvents(
      process.env.EVENTBRIDGE_BUS_NAME ?? DEFAULT_BUS_NAME,
      getEventBridgeClient(),
      logger,
    ),
    // replace with a real inventory system integration for production
    inventoryProvider: new MockInventoryProvider(),
  };
}
