import type { CollaborationController } from '@livebrary/collaboration'

let current: CollaborationController | null = null

export function setCollaboration(value: CollaborationController | null): void {
  current = value
}

export function collaboration(): CollaborationController | null {
  return current
}
