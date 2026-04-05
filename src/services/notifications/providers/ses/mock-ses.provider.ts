import { INotificationProvider, SendEmailParams } from "../notification-provider.interface";

/**
 * Mock SES provider — logs emails to stdout instead of sending.
 * Replace with a real AWS SES implementation when deploying.
 */
export class MockSesProvider implements INotificationProvider {
  async sendEmail(params: SendEmailParams): Promise<void> {
    console.log("[MockSES] Sending email", {
      to: params.to,
      subject: params.subject,
      body: params.body,
    });
  }
}
