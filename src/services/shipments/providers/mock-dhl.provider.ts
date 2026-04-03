import { IShippingProvider, ShipResult } from "./shipping-provider.interface";
import { Address, ShipmentItem } from "../types";

/**
 * Mock DHL provider — always returns ok with a fake tracking number.
 * Replace with real DHL API integration when ready.
 */
export class MockDhlProvider implements IShippingProvider {
  async ship(params: {
    shipmentId: string;
    orderId: string;
    items: ShipmentItem[];
    address: Address;
  }): Promise<ShipResult> {
    const trackingNumber = `DHL${params.shipmentId.replace("shp_", "").toUpperCase()}`;
    return { trackingNumber };
  }
}
