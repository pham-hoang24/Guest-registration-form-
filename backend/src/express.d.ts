import type { OwnerIdentity } from "./types.js";

declare global {
  namespace Express {
    interface Request {
      owner?: OwnerIdentity;
    }
  }
}

export {};
