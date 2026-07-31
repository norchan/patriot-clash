// GOOGLE PLAY BILLING — browser side.
//
// Inside the Android TWA, Chrome exposes the Digital Goods API and a
// "https://play.google.com/billing" payment method. On the open web neither
// exists, so the same shop falls back to Stripe. Feature-detection is the
// right test here — not a user-agent sniff and not the android-app:// referrer,
// because the referrer is only set on the FIRST navigation and is gone as soon
// as the player taps through to another page.

const PLAY_METHOD = 'https://play.google.com/billing'

type DGService = {
  getDetails(skus: string[]): Promise<Array<{ itemId: string; title?: string; price?: unknown }>>
  consume(purchaseToken: string): Promise<void>
  listPurchases?(): Promise<Array<{ itemId: string; purchaseToken: string }>>
}

function dgFactory(): ((method: string) => Promise<DGService>) | null {
  const w = window as any
  return typeof w?.getDigitalGoodsService === 'function' ? w.getDigitalGoodsService.bind(w) : null
}

/** Is this the Android app with Play Billing available? */
export async function playBillingAvailable(): Promise<boolean> {
  const f = dgFactory()
  if (!f || typeof (window as any).PaymentRequest !== 'function') return false
  try {
    await f(PLAY_METHOD)
    return true
  } catch {
    return false // TWA without billing, or Play unavailable on this device
  }
}

export interface PlayBuyResult {
  ok: boolean
  /** already-owned/duplicate and cancelled are NOT errors worth alarming over */
  cancelled?: boolean
  error?: string
  fp?: number
}

/**
 * Buy one FP pack through Google Play, then have the SERVER verify it before
 * anything is granted. We only consume the purchase after our own server has
 * confirmed the grant — consuming first would make the token unrecoverable if
 * verification then failed, and the player would have paid for nothing.
 */
export async function buyWithPlay(productId: string): Promise<PlayBuyResult> {
  const f = dgFactory()
  if (!f) return { ok: false, error: 'Play Billing unavailable' }

  let service: DGService
  try {
    service = await f(PLAY_METHOD)
  } catch {
    return { ok: false, error: 'Play Billing unavailable' }
  }

  // Play requires the SKU to exist; a missing product means it wasn't created
  // in Play Console (or is still in draft) and is worth saying plainly.
  try {
    const details = await service.getDetails([productId])
    if (!details.length) return { ok: false, error: 'That pack is not available on this device yet' }
  } catch { /* getDetails is advisory — carry on and let PaymentRequest decide */ }

  let response: any
  try {
    const request = new (window as any).PaymentRequest(
      [{ supportedMethods: PLAY_METHOD, data: { sku: productId } }],
      // Play supplies the real price; this total is a required placeholder
      { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } },
    )
    response = await request.show()
  } catch (err: any) {
    if (err?.name === 'AbortError') return { ok: false, cancelled: true }
    return { ok: false, error: 'Purchase could not be started' }
  }

  const purchaseToken: string | undefined =
    response?.details?.purchaseToken ?? response?.details?.token

  if (!purchaseToken) {
    await response?.complete?.('fail')
    return { ok: false, error: 'Play did not return a purchase token' }
  }

  // SERVER decides. The client never grants itself FP.
  let granted = 0
  try {
    const res = await fetch('/api/shop/play-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: productId, purchase_token: purchaseToken }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) {
      await response.complete('fail')
      return { ok: false, error: data.error ?? 'Purchase could not be verified' }
    }
    granted = data.fp ?? 0
  } catch {
    // Network died after paying. Do NOT consume — the token stays valid so the
    // purchase can be re-verified later instead of vanishing.
    await response.complete('fail')
    return { ok: false, error: 'Network error — your purchase is safe, reopen the shop to finish' }
  }

  await response.complete('success')
  // Consumable: consume so the pack can be bought again. Failure here is not
  // fatal — the FP is already granted and the token is recorded as claimed.
  try { await service.consume(purchaseToken) } catch { /* Play will retry */ }

  return { ok: true, fp: granted }
}
