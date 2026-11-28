'use client'

import { apiFetch } from '@/lib/api-client'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMissionControl } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import { A360_OBSERVATION_MODE } from '@/lib/a360-mode'

export function LocalModeBanner() {
  const { dashboardMode, bannerDismissed, capabilitiesChecked, dismissBanner } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()
  const [feeds, setFeeds] = useState<Array<{client: string; checked: string | null; status: string}>>([])
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!A360_OBSERVATION_MODE) return
    let cancelled = false
    const refresh = async () => {
      setNow(Date.now())
      try { const data = await apiFetch<{snapshot?: {sources?: Array<{client: string; checked: string | null; status: string}>}}>('/api/a360/observations'); if (!cancelled) setFeeds(data.snapshot?.sources ?? []) } catch { if (!cancelled) setFeeds([]) }
    }
    void refresh(); const timer = setInterval(refresh, 60000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])
  const t = useTranslations('localModeBanner')
  const tc = useTranslations('common')

  if (!capabilitiesChecked || dashboardMode === 'full' || bannerDismissed) return null

  if (A360_OBSERVATION_MODE) return (
    <div className="mx-4 mt-3 px-4 py-2.5 text-xs text-muted-foreground border-b border-border" role="note">
      <span className="font-medium text-foreground">A360 observation mode. </span>
      {feeds.length === 0 && <span>Metadata feed not verified. </span>}
      {feeds.map(feed => { const stale = !feed.checked || now - Date.parse(feed.checked) > 300000 || feed.status !== 'read'; return <span key={feed.client} className={stale ? 'text-destructive' : ''}>{feed.client === 'codex' ? 'Codex' : 'Claude'}: {stale ? 'Stale / unavailable' : 'checked ' + new Date(feed.checked!).toLocaleString()}. </span> })}
      Chats show saved session history, not a live connection to the original chat. Activity shows relay updates and their freshness. Send requests in your original Claude or Codex chat.
    </div>
  )

  return (
    <div className="mx-4 mt-3 mb-0 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-void-cyan/5 border border-void-cyan/15 text-sm">
      <span className="w-1.5 h-1.5 rounded-full bg-void-cyan shrink-0" />
      <p className="flex-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t('noGatewayDetected')}</span>
        {t('runningInLocalMode')}
      </p>
      <Button
        variant="outline"
        size="xs"
        onClick={() => navigateToPanel('gateways')}
        className="shrink-0 text-2xs font-medium text-void-cyan hover:text-void-cyan/80 border-void-cyan/20 hover:border-void-cyan/40"
      >
        {t('configureGateway')}
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={dismissBanner}
        className="shrink-0 text-void-cyan/60 hover:text-void-cyan hover:bg-transparent"
        title={tc('dismiss')}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </Button>
    </div>
  )
}
