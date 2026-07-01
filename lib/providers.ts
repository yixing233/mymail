import { listProviderConfigs } from "@/lib/provider-store";
import type { MailProviderGroup } from "@/lib/types";

export function getDefaultProviders(): MailProviderGroup[] {
  return listProviderConfigs();
}
