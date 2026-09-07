import { api } from "./client";

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: string;
}

/** Only ever returned at creation. There is no endpoint that shows it again. */
export interface CreatedWebhook extends Webhook {
  secret: string;
}

export const webhooksApi = {
  /**
   * Returns the subscriptions and the events that can be subscribed to.
   *
   * The list of events comes from the server rather than being repeated here,
   * so a newly published event appears in the UI without a web release.
   */
  list: () =>
    api.getEnvelope<{ data: Webhook[]; events: string[] }>("/api/v1/webhooks"),

  create: (url: string, events: string[]) =>
    api.post<CreatedWebhook>("/api/v1/webhooks", { url, events }),

  remove: (id: string) => api.del(`/api/v1/webhooks/${id}`),
};
