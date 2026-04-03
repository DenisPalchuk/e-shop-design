import { Address, ShipmentItem } from "../types";

export interface ShipResult {
  trackingNumber: string;
}

export interface IShippingProvider {
  ship(params: {
    shipmentId: string;
    orderId: string;
    items: ShipmentItem[];
    address: Address;
  }): Promise<ShipResult>;
}
