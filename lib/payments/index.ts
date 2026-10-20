// Public surface of the payments integration.
//
// Importing this module registers this ERP's fee fulfiller, so any route that drives an
// order through here (create / webhook / status) has fulfillment wired. Another app
// would import the same core and call registerFulfiller() with its own handler instead.
import { registerFulfiller } from './fulfillers';
import { fulfillFeesOrder } from './fulfill';

// Register once (module singletons are cached by Node, so this runs a single time).
registerFulfiller('FEES', fulfillFeesOrder);

export { registerFulfiller } from './fulfillers';
export {
  createOrder,
  getOrder,
  syncStatus,
  markPaid,
  confirmFromWebhook,
  resolveOrder,
  listRecent,
  genRef,
} from './orders';
export type { CreateOrderInput, CreateOrderResult } from './orders';
export { getProvider } from './providers';
export type { PaymentProvider, ProviderStatus } from './providers';
