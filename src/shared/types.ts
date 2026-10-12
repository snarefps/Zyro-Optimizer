export type Risk = 'safe' | 'low' | 'medium' | 'high'
export interface ScanItem { id: string; label: string; detail?: string; sizeBytes?: number; risk: Risk; needsAdmin?: boolean; meta?: Record<string, unknown> }
export interface ItemResult { id: string; status: 'ok' | 'skipped' | 'failed'; reason?: string; freedBytes?: number }
export interface UndoEntry { id: string; ts: number; module: string; label: string; kind: 'registry' | 'service' | 'startup' | 'power' | 'appx' | 'none'; undo?: Record<string, unknown>; reverted?: boolean }
