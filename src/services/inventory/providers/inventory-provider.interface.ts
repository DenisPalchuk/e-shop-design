import { UnavailableItem } from "../types";

export interface CheckStockParams {
  items: { productId: string; variantId?: string; quantity: number }[];
}

export interface CheckStockResult {
  allInStock: boolean;
  unavailableItems: UnavailableItem[];
}

export interface IInventoryProvider {
  checkStock(params: CheckStockParams): Promise<CheckStockResult>;
}
