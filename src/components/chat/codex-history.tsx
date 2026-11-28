'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { SessionMessage, shouldShowTimestamp } from './session-message'
import type { ChatHistory } from '@/lib/a360-chat-history'

export function CodexHistory({ sessionId }: { sessionId: string }) {
  const [history, setHistory] = useState<ChatHistory | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const read = async () => {
      try {
        const data = await apiFetch<{ history: ChatHistory | null }>(`/api/a360/chat-history?id=${encodeURIComponent(sessionId)}`)
        if (!cancelled) { setHistory(data.history); setError(null) }
      } catch { if (!cancelled) setError('History could not be checked. Refresh the page to try again.') }
    }
    void read()
    return () => { cancelled = true }
  }, [sessionId])
  useEffect(() => {
    if (history?.status !== 'requested') return
    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const data = await apiFetch<{ history: ChatHistory | null }>(`/api/a360/chat-history?id=${encodeURIComponent(sessionId)}`)
        if (!cancelled) setHistory(data.history)
      } catch { if (!cancelled) setError('Waiting for the connection. No new history has been verified.') }
    }, 5000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [sessionId, history?.status])
  useEffect(() => {
    if (!history) return
    const remaining = Date.parse(history.expires) - Date.now()
    const timer = setTimeout(() => setHistory(null), Math.max(0, remaining))
    return () => clearTimeout(timer)
  }, [history])

  async function load() {
    setBusy(true); setError(null)
    try {
      const data = await apiFetch<{ history: ChatHistory }>('/api/a360/chat-history', {
        method: 'POST', body: JSON.stringify({ session_id: sessionId }),
      })
      setHistory(data.history)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'History request failed. Check the Windows publisher.') }
    finally { setBusy(false) }
  }
  const messages = (history?.messages ?? []).map(message => ({ role: message.role,
    timestamp: message.timestamp, parts: [{ type: 'text' as const, text: message.text }] }))
  return (
    <section aria-label="Codex recent history" className="min-w-0 space-y-3 break-words px-4 text-sm">
      <div className="space-y-2 py-2 text-xs text-muted-foreground">
        <p>Load up to 40 recent messages from this Codex chat. Only this selected chat is read; excerpts are saved on this hosted dashboard for up to 30 minutes. Tool output and internal reasoning are excluded. Detected secrets are withheld.</p>
        <p className="break-all">Original chat: {sessionId}</p>
        <Button variant="outline" size="sm" className="min-h-11" onClick={() => void load()} disabled={busy || history?.status === 'requested'}>
          {busy ? 'Requesting history…' : history?.status === 'requested' ? 'Waiting for Windows…' : history?.status === 'available' ? 'Refresh recent history' : 'Load recent history'}
        </Button>
        {history?.status === 'requested' && <p role="status">The Windows publisher checks every minute. If the PC is offline, this request expires after five minutes.</p>}
        {history?.status === 'available' && <p role="status">Fetched {new Date(history.fetched).toLocaleString()}. This is saved history; it does not prove the agent is running.</p>}
        {history?.status === 'available' && messages.length === 0 && <p>No readable user or assistant messages were found in the recent file segment.</p>}
        {history?.status === 'unavailable' && <p role="status">Windows could not read this original chat. It may be archived, unavailable on this PC, or outside the supported session folder.</p>}
        {history?.status === 'expired' && <p role="status">Windows did not return history within five minutes. Check the PC and publisher, then request again.</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
      {messages.map((message, index) => <SessionMessage key={`${message.timestamp}-${index}`} message={message} showTimestamp={shouldShowTimestamp(message, messages[index - 1])} />)}
    </section>
  )
}
