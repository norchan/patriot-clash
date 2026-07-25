import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { fetchLinkPreview } from '@/lib/link-preview'

// GET /api/link-preview?url= — the Create-a-post page's URL autofill
// (Michael): paste a link, the form preloads title/body from its preview.
// Signed-in only; best-effort like every preview fetch.

export async function GET(req: NextRequest) {
  try {
    await requireProfile()
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
