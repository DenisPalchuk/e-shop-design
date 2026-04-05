import {
  IInventoryProvider,
  CheckStockParams,
  CheckStockResult,
} from "../inventory-provider.interface";

/**
 * Mock inventory provider — all items are in stock by default.
 * Set MOCK_OUT_OF_STOCK_PRODUCT_IDS env var (comma-separated) to simulate failures.
 * Replace with a real inventory system call in production.
 */
export class MockInventoryProvider implements IInventoryProvider {
  async checkStock(params: CheckStockParams): Promise<CheckStockResult> {
    const outOfStockIds = (process.env.MOCK_OUT_OF_STOCK_PRODUCT_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const unavailableItems = params.items
      .filter((item) => outOfStockIds.includes(item.productId))
      .map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        requestedQty: item.quantity,
        availableQty: 0,
      }));

    return {
      allInStock: unavailableItems.length === 0,
      unavailableItems,
    };
  }
}
