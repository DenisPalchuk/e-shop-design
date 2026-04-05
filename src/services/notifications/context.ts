import { getDb } from "../../shared/db";
import { Logger } from "../../shared/logger";
import { CustomerRepository } from "./repositories/customer.repository";
import { NotificationRepository } from "./repositories/notification.repository";
import { INotificationProvider } from "./providers/notification-provider.interface";
import { MockSesProvider } from "./providers/ses/mock-ses.provider";

export interface NotificationsContext {
  customerRepository: CustomerRepository;
  notificationRepository: NotificationRepository;
  notificationProvider: INotificationProvider;
}

export async function init(logger: Logger): Promise<NotificationsContext> {
  const db = await getDb();

  return {
    customerRepository: new CustomerRepository(db, logger),
    notificationRepository: new NotificationRepository(db, logger),
    // replace with real SES provider implementation for production
    notificationProvider: new MockSesProvider(),
  };
}
