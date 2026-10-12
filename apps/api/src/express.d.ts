import type { SessionUser } from './identity.js'

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser
      gateId?: string
    }
  }
}

export {}
