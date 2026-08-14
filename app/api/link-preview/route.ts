import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { fetchLinkPreview } from '@/lib/link-preview'
import { rateLimited } from '@/lib/ratelimit'

// GET /api/link-preview?url= — the Create-a-post page's URL autofill
// (Michael): paste a link, the form preloads title/body from its preview.
// Signed-in only; best-effort like every preview fetch.

export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    // a signed-in account could otherwise use us as a free outbound-fetch
    // proxy; the client debounces, so a human never gets near this
    if (rateLimited(`linkprev:${profile.id}`, 12, 60_000)) {
      return NextResponse.json({ preview: null })
    }
    const url = req.nextUrl.searchParams.get('url') ?? ''
    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
    }
    const preview = await fetchLinkPreview(url)
    return NextResponse.json({ preview })
  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Preview failed' }, { status: 500 })
  }
}
