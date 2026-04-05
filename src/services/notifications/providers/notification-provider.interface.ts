export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
}

export interface INotificationProvider {
  sendEmail(params: SendEmailParams): Promise<void>;
}
